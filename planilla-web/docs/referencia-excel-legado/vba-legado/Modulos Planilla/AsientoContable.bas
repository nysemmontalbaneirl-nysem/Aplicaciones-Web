Attribute VB_Name = "AsientoContable"
Option Explicit

'========================================================================================
' Macro: ExportarRango_Txt_y_Excel_Texto
' Autor: Programador de Macros VBA para Miguel Montalban
' Descripción: Exporta un rango específico a un archivo TXT, lo importa a un nuevo libro
'              Excel, filtra valores vacíos/nulos en columna D y guarda el resultado.
'              La ruta de guardado se gestiona en el Registro de Windows.
'========================================================================================

Sub ExportarRango_Txt_y_Excel_Texto()

    ' --- Optimización de rendimiento
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual
    Application.EnableEvents = False

    Dim wbOrigen As Workbook, ws As Worksheet, rng As Range
    Dim Carpeta As String, NombreArchivo As String, RutaTxt As String
    Dim fso As Object, ts As Object
    Dim i As Long, j As Long
    Dim NuevoLibro As Workbook
    Dim qt As QueryTable
    Dim nCols As Long, linea As String
    
    ' --- Definición de claves para Registro de Windows
    Const APP_NAME As String = "Nysem_Contabilidad"
    Const SECCION As String = "Rutas"
    Const KEY_NAME As String = "UltimaCarpeta"
    
    ' --- Recuperar ruta del registro (si no existe, queda vacía)
    Carpeta = GetSetting(APP_NAME, SECCION, KEY_NAME, "")
    
    ' --- Selección de Carpeta
    Dim fd As FileDialog
    Set fd = Application.FileDialog(msoFileDialogFolderPicker)
    
    With fd
        .Title = "Seleccione la carpeta donde guardar el asiento contable"
        If Carpeta <> "" Then .InitialFileName = Carpeta
        .ButtonName = "Seleccionar"
        
        If .Show = -1 Then
            Carpeta = .SelectedItems(1) & "\"
            ' Guardar la nueva ruta seleccionada para la próxima vez
            SaveSetting APP_NAME, SECCION, KEY_NAME, Carpeta
        Else
            ' Si el usuario cancela, salimos de forma segura
            GoTo Salida
        End If
    End With

    ' --- Configuración de origen
    Set wbOrigen = ActiveWorkbook
    Set ws = wbOrigen.Worksheets("ASIENTO_MENSUAL")
    Set rng = ws.Range("A1:P428")
    nCols = rng.Columns.Count

    ' --- Definir nombre de archivo
    NombreArchivo = Sanitize(CStr(ws.Range("Z1").Value))
    If Len(NombreArchivo) = 0 Then NombreArchivo = "Export_" & Format(Now, "yyyymmdd_hhnnss")
    RutaTxt = Carpeta & NombreArchivo & ".txt"

    ' --- 1) Volcar datos a TXT usando FSO
    Set fso = CreateObject("Scripting.FileSystemObject")
    Set ts = fso.CreateTextFile(RutaTxt, True, False)
    
    For i = 1 To rng.Rows.Count
        linea = ""
        For j = 1 To nCols
            linea = linea & LimpiaTexto(rng.Cells(i, j).Text)
            If j < nCols Then linea = linea & vbTab
        Next j
        ts.WriteLine linea
    Next i
    ts.Close

    ' --- 2) Importar TXT a un nuevo libro
    Set NuevoLibro = Workbooks.Add(xlWBATWorksheet)
    With NuevoLibro.Sheets(1)
        Set qt = .QueryTables.Add(Connection:="TEXT;" & RutaTxt, Destination:=.Range("A1"))
    End With

    With qt
        .TextFileParseType = xlDelimited
        .TextFileTabDelimiter = True
        .TextFileColumnDataTypes = ColumnTypes_D_Numerica(nCols)
        .AdjustColumnWidth = False
        .Refresh BackgroundQuery:=False
        .Delete
    End With

    ' --- 2.5) Limpieza de registros con columna D sin valor
    Dim ultFila As Long, fila As Long, valor As String
    With NuevoLibro.Sheets(1)
        ultFila = .Cells(.Rows.Count, "D").End(xlUp).Row
        For fila = ultFila To 1 Step -1
            valor = Trim(.Cells(fila, "D").Value)
            If valor = "" Or valor = "0" Or valor = "-" Or valor = "0.00" Then
                .Rows(fila).Delete
            End If
        Next fila
        .Columns("D").NumberFormat = "0.00"
    End With

    ' --- 3) Guardar archivo final
    Application.DisplayAlerts = False
    NuevoLibro.SaveAs fileName:=Carpeta & NombreArchivo & ".xlsx", FileFormat:=xlOpenXMLWorkbook
    Application.DisplayAlerts = True
    NuevoLibro.Close SaveChanges:=False

    ' --- 4) Eliminar archivo temporal TXT
    If fso.FileExists(RutaTxt) Then fso.DeleteFile RutaTxt, True

    MsgBox "Proceso completado con éxito." & vbCrLf & "Archivo guardado en: " & Carpeta, vbInformation

Salida:
    ' --- Restaurar configuración de Excel
    Application.ScreenUpdating = True
    Application.Calculation = xlCalculationAutomatic
    Application.EnableEvents = True
End Sub

' === Funciones auxiliares
Function ColumnTypes_D_Numerica(n As Long) As Variant
    Dim a() As Integer, k As Long
    ReDim a(1 To n)
    For k = 1 To n
        If k = 4 Then a(k) = 1 Else a(k) = 2
    Next k
    ColumnTypes_D_Numerica = a
End Function

Function LimpiaTexto(ByVal s As String) As String
    s = Application.WorksheetFunction.Clean(s)
    s = Replace(s, Chr(160), "")
    s = Application.WorksheetFunction.Trim(s)
    LimpiaTexto = Trim(s)
End Function

Function Sanitize(ByVal s As String) As String
    Dim invalid As Variant, ch As Variant
    invalid = Array("\", "/", ":", "*", "?", """", "<", ">", "|")
    For Each ch In invalid
        s = Replace(s, ch, "_")
    Next
    Sanitize = Trim(s)
End Function
