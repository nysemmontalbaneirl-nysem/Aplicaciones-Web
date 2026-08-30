Attribute VB_Name = "exporta_pdf"
Option Explicit
Public DetenerProceso As Boolean

Sub Exportar_Boletas_PDF()
    Dim hojaControl As Worksheet, hojaRegistro As Worksheet
    Dim hojaOrigen As Worksheet
    Dim celdaCombo As Range, celdaNombrePDF As Range
    Dim listaValores As Variant
    Dim i As Long, inicio As Long, fin As Long
    Dim opcion As Variant
    Dim rutaBase As String, rutaCompleta As String
    Dim nombreArchivoBase As String, nombreArchivoFinal As String
    Dim charsInvalidos As Variant
    Dim contador As Integer, filaRegistro As Long
    Dim valorActual As Variant
    Dim rutaNueva As String
    Dim hojaDatos As String, rangoDatos As String
    Dim formulaRango As String
    Dim totalFilas As Long
    Dim hayValidos As Boolean

    On Error GoTo ManejoError

    Set hojaControl = ThisWorkbook.Sheets("BOLETA_PAGO")
    Set celdaCombo = hojaControl.Range("E1")
    Set celdaNombrePDF = hojaControl.Range("C9")

    ' Detectar hoja y rango de la validación (INDIRECTO)
    hojaDatos = hojaControl.Range("C1").Value
    rangoDatos = hojaControl.Range("I5").Value
    formulaRango = hojaDatos & rangoDatos

    ' Verificar que la hoja y rango existan
    If Not HojaExiste(hojaDatos) Then
        MsgBox "No se encontró la hoja '" & hojaDatos & "'.", vbCritical
        Exit Sub
    End If
    Set hojaOrigen = ThisWorkbook.Sheets(hojaDatos)

    On Error Resume Next
    listaValores = hojaOrigen.Range(Mid(rangoDatos, 2)).Value
    On Error GoTo 0

    If IsEmpty(listaValores) Then
        MsgBox "No se pudo obtener la lista de trabajadores desde la validación en E1." & vbCrLf & _
               "Verifica las celdas C1 e I5.", vbCritical
        Exit Sub
    End If

    ' Preguntar ruta de guardado
    With Application.FileDialog(msoFileDialogFolderPicker)
        .Title = "Selecciona la carpeta donde deseas guardar los PDFs"
        If .Show <> -1 Then Exit Sub
        rutaBase = .SelectedItems(1)
    End With

    ' Preguntar si desea crear nueva carpeta
    If MsgBox("¿Deseas crear una subcarpeta dentro de esa ruta?", vbYesNo + vbQuestion, "Nueva Carpeta") = vbYes Then
        rutaNueva = InputBox("Escribe el nombre de la nueva carpeta:", "Nombre Carpeta", "Boletas_" & Format(Date, "yyyymmdd"))
        If rutaNueva <> "" Then
            rutaBase = rutaBase & "\" & rutaNueva
            If Dir(rutaBase, vbDirectory) = "" Then MkDir rutaBase
        End If
    End If

    ' Crear hoja Registro si no existe
    On Error Resume Next
    Set hojaRegistro = ThisWorkbook.Sheets("Registro")
    If hojaRegistro Is Nothing Then
        Set hojaRegistro = ThisWorkbook.Sheets.Add(After:=Sheets(Sheets.Count))
        hojaRegistro.Name = "Registro"
        hojaRegistro.Range("A1:D1").Value = Array("Código", "Nombre Archivo", "Fecha", "Ruta")
    End If
    On Error GoTo 0

    ' Configuración
    charsInvalidos = Array("\", "/", ":", "*", "?", """", "<", ">", "|")
    filaRegistro = hojaRegistro.Cells(hojaRegistro.Rows.Count, "A").End(xlUp).Row + 1

    ' Elegir opción
    opcion = Application.InputBox( _
        Prompt:="¿Qué deseas exportar?" & vbCrLf & _
                "1 = Una boleta específica" & vbCrLf & _
                "2 = Un rango de boletas" & vbCrLf & _
                "3 = Todas las boletas", _
        Title:="Exportar Boletas a PDF", Type:=1)

    If opcion < 1 Or opcion > 3 Then Exit Sub

    ' Habilitar cancelación con ESC
    Application.EnableCancelKey = xlInterrupt
    DetenerProceso = False
    hayValidos = False

    Select Case opcion
        Case 1 ' Solo una boleta
            valorActual = InputBox("Ingresa el código exacto del trabajador (columna C del rango):", "Código trabajador")
            If valorActual = "" Or valorActual = 0 Then
                MsgBox "Código vacío o 0. No se exportará nada.", vbExclamation
                Exit Sub
            End If
            hayValidos = True
            Call ExportarBoleta(valorActual, hojaControl, celdaCombo, celdaNombrePDF, rutaBase, charsInvalidos, hojaRegistro, filaRegistro)

        Case 2 ' Rango
            inicio = Application.InputBox("Ingresa la fila inicial del rango (1 = primera persona):", Type:=1)
            fin = Application.InputBox("Ingresa la fila final del rango:", Type:=1)
            If inicio < 1 Or fin < inicio Then Exit Sub

            For i = inicio To fin
                If DetenerProceso Then Exit For
                valorActual = hojaOrigen.Cells(4 + i, 3).Value ' columna C
                If Trim(valorActual) <> "" And valorActual <> 0 Then
                    hayValidos = True
                    Call ExportarBoleta(valorActual, hojaControl, celdaCombo, celdaNombrePDF, rutaBase, charsInvalidos, hojaRegistro, filaRegistro)
                    DoEvents
                End If
            Next i

        Case 3 ' Todas
            totalFilas = UBound(listaValores, 1)
            For i = 1 To totalFilas
                If DetenerProceso Then Exit For
                valorActual = listaValores(i, 1)
                If Trim(valorActual) <> "" And valorActual <> 0 Then
                    hayValidos = True
                    Call ExportarBoleta(valorActual, hojaControl, celdaCombo, celdaNombrePDF, rutaBase, charsInvalidos, hojaRegistro, filaRegistro)
                    DoEvents
                End If
            Next i
    End Select

    If Not hayValidos Then
        MsgBox "No se encontró ningún valor válido (no nulo ni cero) para exportar.", vbInformation
    Else
        MsgBox "Proceso completado.", vbInformation
        Shell "explorer.exe """ & rutaBase & """", vbNormalFocus
    End If

    Exit Sub

ManejoError:
    If Err.Number = 18 Then
        MsgBox "Proceso detenido manualmente.", vbExclamation
    ElseIf Err.Number <> 0 Then
        MsgBox "Error: " & Err.Description, vbCritical
    End If
End Sub


Private Sub ExportarBoleta(valor As Variant, hojaControl As Worksheet, celdaCombo As Range, _
    celdaNombrePDF As Range, rutaBase As String, charsInvalidos As Variant, _
    hojaRegistro As Worksheet, ByRef filaRegistro As Long)

    Dim nombreArchivoBase As String, nombreArchivoFinal As String
    Dim rutaCompleta As String, contador As Integer
    Dim j As Long

    celdaCombo.Value = valor
    DoEvents

    nombreArchivoBase = celdaNombrePDF.Value
    For j = LBound(charsInvalidos) To UBound(charsInvalidos)
        nombreArchivoBase = Replace(nombreArchivoBase, charsInvalidos(j), "_")
    Next j

    nombreArchivoFinal = nombreArchivoBase
    rutaCompleta = rutaBase & "\" & nombreArchivoFinal & ".pdf"

    contador = 1
    Do While Dir(rutaCompleta) <> ""
        nombreArchivoFinal = nombreArchivoBase & " (" & contador & ")"
        rutaCompleta = rutaBase & "\" & nombreArchivoFinal & ".pdf"
        contador = contador + 1
    Loop

    hojaControl.ExportAsFixedFormat Type:=xlTypePDF, fileName:=rutaCompleta, _
        Quality:=xlQualityStandard, IncludeDocProperties:=True, IgnorePrintAreas:=False, OpenAfterPublish:=False

    hojaRegistro.Cells(filaRegistro, 1).Value = valor
    hojaRegistro.Cells(filaRegistro, 2).Value = nombreArchivoFinal & ".pdf"
    hojaRegistro.Cells(filaRegistro, 3).Value = Format(Now, "dd-mm-yyyy hh:nn:ss")
    hojaRegistro.Cells(filaRegistro, 4).Value = rutaCompleta
    filaRegistro = filaRegistro + 1
End Sub

Private Function HojaExiste(nombre As String) As Boolean
    Dim ws As Worksheet
    On Error Resume Next
    Set ws = ThisWorkbook.Sheets(nombre)
    HojaExiste = Not ws Is Nothing
    On Error GoTo 0
End Function



