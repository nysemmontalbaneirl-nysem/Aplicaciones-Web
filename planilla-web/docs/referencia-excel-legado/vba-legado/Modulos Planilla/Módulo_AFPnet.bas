Attribute VB_Name = "Módulo_AFPnet"
Option Explicit

' --- MACRO 1: PROCESAMIENTO PRINCIPAL ---
Sub Generar_AFPnet_Principal()
    Dim wsGenera As Worksheet, wsPlanilla As Worksheet, wsMaestro As Worksheet
    Dim nombreQuincena As String, pass As String
    Dim dataPlanilla As Variant, resultadoCUSPP() As Variant
    Dim i As Long, contador As Long
    Dim uFilaPlanilla As Long, uFilaLimpieza As Long
    Dim rngFórmulas As Range
    
    ' Definición de clave
    pass = ",}vkq6V@X2C+8YGp?{+s"
    
    ' Bloqueo de interrupciones
    With Application
        .ScreenUpdating = False
        .Calculation = xlCalculationManual
        .EnableEvents = False
        .Interactive = False
        .Cursor = xlWait
    End With

    On Error GoTo Salida

    Set wsGenera = ThisWorkbook.Sheets("GENERA_AFP")
    Set wsMaestro = ThisWorkbook.Sheets("MAESTRO")
    nombreQuincena = wsGenera.Range("D1").Value

    ' Desproteger hoja con tu clave
    wsGenera.Unprotect Password:=pass

    ' VALIDAR HOJA DE ORIGEN
    On Error Resume Next
    Set wsPlanilla = ThisWorkbook.Sheets(nombreQuincena)
    On Error GoTo Salida
    
    If wsPlanilla Is Nothing Or nombreQuincena = "" Then
        MsgBox "Seleccione una quincena válida en D1.", vbExclamation
        GoTo Salida
    End If

    ' EXTRAER CUSPP
    uFilaPlanilla = wsPlanilla.Cells(wsPlanilla.Rows.Count, "L").End(xlUp).Row
    dataPlanilla = wsPlanilla.Range("L1:L" & uFilaPlanilla).Value
    ReDim resultadoCUSPP(1 To UBound(dataPlanilla, 1), 1 To 1)
    contador = 0

    For i = 5 To UBound(dataPlanilla, 1)
        If Len(Trim(dataPlanilla(i, 1))) >= 10 Then
            contador = contador + 1
            resultadoCUSPP(contador, 1) = Trim(dataPlanilla(i, 1))
        End If
    Next i

    ' LIMPIEZA
    uFilaLimpieza = wsGenera.Cells(wsGenera.Rows.Count, "B").End(xlUp).Row
    If uFilaLimpieza >= 3 Then wsGenera.Range("A3:W" & uFilaLimpieza + 200).ClearContents

    ' VOLCADO Y VALORES
    If contador > 0 Then
        wsGenera.Range("B3:B" & (contador + 2)).NumberFormat = "@"
        wsGenera.Range("D3:D" & (contador + 2)).NumberFormat = "@"
        
        wsGenera.Range("B3").Resize(contador, 1).Value = resultadoCUSPP
        wsGenera.Range("G1").Value = wsMaestro.Range("B25").Value
        wsGenera.Range("K1").Value = wsMaestro.Range("B26").Value
        
        Set rngFórmulas = wsGenera.Range("C3:W" & (contador + 2))
        wsMaestro.Range("C28:W28").Copy
        rngFórmulas.PasteSpecial Paste:=xlPasteFormulas
        
        With rngFórmulas
            .Replace "$27", "$2", xlPart
            .Replace "$D$25", "$D$1", xlPart
            .Replace "$B$25", "$G$1", xlPart
            .Replace "$B$26", "$K$1", xlPart
            .Replace "MAESTRO!", "", xlPart
            wsGenera.Calculate
            .Value = .Value
        End With
        
        With wsGenera.Range("A3:A" & (contador + 2))
            .Formula = "=ROW()-2"
            .Value = .Value
        End With
    End If

Salida:
    ' Volver a proteger con la clave
    wsGenera.Protect Password:=pass, UserInterfaceOnly:=True
    With Application
        .ScreenUpdating = True
        .Calculation = xlCalculationAutomatic
        .EnableEvents = True
        .Interactive = True
        .Cursor = xlDefault
    End With
    If Err.Number <> 0 Then
        MsgBox "Error: " & Err.Description, vbCritical
    ElseIf contador > 0 Then
        MsgBox "Procesamiento de quincena completado.", vbInformation
    End If
End Sub

' --- MACRO 2: EXPORTACIÓN AUTOMÁTICA ---
Sub Exportar_AFPnet_Filtrado()
    Dim wsGenera As Worksheet: Set wsGenera = ThisWorkbook.Sheets("GENERA_AFP")
    Dim wbNuevo As Workbook, rngExport As Range, shellApp As Object
    Dim folderPath As String, NombreArchivo As String, pass As String
    Dim nombreProyecto As String, nombreQuincena As String, uFila As Long

    pass = ",}vkq6V@X2C+8YGp?{+s"
    nombreProyecto = wsGenera.Range("A1").Value
    nombreQuincena = wsGenera.Range("D1").Value
    uFila = wsGenera.Cells(wsGenera.Rows.Count, "B").End(xlUp).Row
    
    If uFila < 3 Then Exit Sub

    ' Desproteger para poder usar el Filtro
    wsGenera.Unprotect Password:=pass
    
    NombreArchivo = nombreQuincena & " - " & nombreProyecto & ".xlsx"
    
    Set shellApp = CreateObject("Shell.Application").BrowseForFolder(0, "Seleccione carpeta de destino:", 0)
    If shellApp Is Nothing Then GoTo Final
    folderPath = shellApp.Self.path & "\"

    Application.ScreenUpdating = False
    wsGenera.AutoFilterMode = False
    
    With wsGenera.Range("A2:W" & uFila)
        If nombreProyecto <> "TODO" Then .AutoFilter Field:=23, Criteria1:=nombreProyecto
        
        On Error Resume Next
        Set rngExport = wsGenera.Range("A3:Q" & uFila).SpecialCells(xlCellTypeVisible)
        On Error GoTo 0
        
        If Not rngExport Is Nothing Then
            Set wbNuevo = Workbooks.Add
            rngExport.Copy
            With wbNuevo.Sheets(1).Range("A1")
                .PasteSpecial Paste:=xlPasteValues
                .PasteSpecial Paste:=xlPasteFormats
                .Offset(0, 1).EntireColumn.NumberFormat = "@" ' Columna B
                .Offset(0, 3).EntireColumn.NumberFormat = "@" ' Columna D
            End With
            wbNuevo.Sheets(1).Columns.AutoFit
            Application.DisplayAlerts = False
            wbNuevo.SaveAs fileName:=folderPath & NombreArchivo
            wbNuevo.Close False
            Application.DisplayAlerts = True
            MsgBox "Exportación exitosa: " & NombreArchivo, vbInformation
        Else
            MsgBox "No se encontraron datos para exportar.", vbExclamation
        End If
    End With

Final:
    wsGenera.AutoFilterMode = False
    wsGenera.Protect Password:=pass, UserInterfaceOnly:=True
    Application.ScreenUpdating = True
End Sub
