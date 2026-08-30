Attribute VB_Name = "CopiaCarga_Estructura"
Public Cancelado As Boolean     'variable global de cancelación

Sub Copia_a_Estructura()
    Dim criterio As String
    Dim wsOrigen As Worksheet, wsDestino As Worksheet
    Dim rngVisible As Range, rngDestino As Range
    Dim filasCopiar As Long, filasDestinoAnterior As Long
    Dim ultFilaDestino As Long
    Dim arrDatos As Variant, arrTexto As Variant
    Dim i As Long, j As Long
    Dim porc As Double
    Dim tInicio As Double, tFin As Double, tTotal As Double
    
    Set wsOrigen = Sheets("GENERA_ESTRUCTURA")
    Set wsDestino = Sheets("PLANILLA-TRABAJADORES")
    
    criterio = Trim(wsDestino.Range("A1").Value)
    
    ' Guardar hora inicio
    tInicio = Timer
    
    Application.ScreenUpdating = False
    Application.DisplayAlerts = False
    Application.EnableEvents = False
    
    ' Mostrar UserForm barra de progreso
    Cancelado = False
    ufProgreso.Show vbModeless
    ufProgreso.lblAvance.Width = 0
    ufProgreso.lblPorcentaje.Caption = "0%"
    
    If UCase(criterio) = "TODOS" Then
        ufProgreso.lbltext.Caption = "Copiando todos los datos (sin vacíos)..."
    Else
        ufProgreso.lbltext.Caption = "Copiando datos del Grupo " & criterio & "..."
    End If
    DoEvents
    
    ' Determinar filas actuales en destino
    ultFilaDestino = wsDestino.Cells(wsDestino.Rows.Count, "C").End(xlUp).Row
    If ultFilaDestino < 7 Then
        filasDestinoAnterior = 0
    Else
        filasDestinoAnterior = ultFilaDestino - 6
    End If
    
    ' Quitar filtros anteriores
    If wsOrigen.AutoFilterMode Then wsOrigen.AutoFilterMode = False
    
    ' --- Aplicar filtro ---
    If UCase(criterio) = "X" Then
        wsOrigen.Range("B3:CK700").AutoFilter Field:=1, Criteria1:="<>"
    Else
        wsOrigen.Range("B3:CK700").AutoFilter Field:=1, Criteria1:=criterio
    End If
    
    ' Capturar datos visibles
    On Error Resume Next
    Set rngVisible = wsOrigen.Range("C4:CK700").SpecialCells(xlCellTypeVisible)
    On Error GoTo 0
    
    If Not rngVisible Is Nothing Then
        filasCopiar = rngVisible.Rows.Count
        Set rngDestino = wsDestino.Range("C7").Resize(filasCopiar, rngVisible.Columns.Count)
        
        ' Limpiar destino (incluye sobrantes)
        wsDestino.Range("C7:CK" & (7 + filasDestinoAnterior)).ClearContents
        
        ' Formatear destino como TEXTO
        rngDestino.NumberFormat = "@"
        
        ' Pasar valores a un array
        arrDatos = rngVisible.Value
        ReDim arrTexto(1 To UBound(arrDatos, 1), 1 To UBound(arrDatos, 2))
        
        ' Convertir todo a texto (mantiene ceros a la izquierda)
        For i = 1 To UBound(arrDatos, 1)
            For j = 1 To UBound(arrDatos, 2)
                If IsEmpty(arrDatos(i, j)) Then
                    arrTexto(i, j) = ""
                Else
                    arrTexto(i, j) = CStr(arrDatos(i, j))
                End If
            Next j
        Next i
        
        ' Pegar array de texto al destino
        rngDestino.Value = arrTexto
        
        ' --- Barra de progreso simplificada ---
        porc = 1
        ufProgreso.lblAvance.Width = porc * ufProgreso.fraContenedor.Width
        ufProgreso.lblPorcentaje.Caption = "100%"
        DoEvents
        
        ' Tiempo total
        tFin = Timer
        tTotal = Round(tFin - tInicio, 2)
        
        ' Mensaje final
        If UCase(criterio) = "TODOS" Then
            MsgBox "Se copiaron todos los datos (sin vacíos)." & vbCrLf & _
                   "Total: " & filasCopiar & " filas." & vbCrLf & _
                   "Progreso: 100%" & vbCrLf & _
                   "Tiempo de ejecución: " & tTotal & " segundos.", vbInformation
        Else
            MsgBox "Los Datos del Grupo " & criterio & " se copiaron correctamente." & vbCrLf & _
                   "Total: " & filasCopiar & " filas." & vbCrLf & _
                   "Progreso: 100%" & vbCrLf & _
                   "Tiempo de ejecución: " & tTotal & " segundos.", vbInformation
        End If
    Else
        wsDestino.Range("C7:CK" & (7 + filasDestinoAnterior)).ClearContents
        MsgBox "No se encontraron datos para el criterio seleccionado.", vbExclamation
    End If
    
Salida:
    Application.CutCopyMode = False
    Unload ufProgreso
    Application.ScreenUpdating = True
    Application.DisplayAlerts = True
    Application.EnableEvents = True
End Sub

Public Sub Carga_Datos_Estructura()
    Dim wsDestino As Worksheet, wsMaestro As Worksheet, wsOrigen As Worksheet
    Dim hojaSel As String
    Dim ultFilaOrigen As Long, filaFin As Long
    Dim arrOrigen As Variant, arrDestino() As String
    Dim i As Long, col As Long
    Dim colIni As Long, colFin As Long
    Dim formulaBase As String
    
    On Error GoTo ErrHandler
    
    Set wsDestino = ThisWorkbook.Sheets("GENERA_ESTRUCTURA")
    Set wsMaestro = ThisWorkbook.Sheets("Maestro")
    
    hojaSel = Trim(wsDestino.Range("D2").Value)
    If hojaSel = "" Then
        MsgBox "Seleccione una hoja en PLANILLA-TRABAJADORES!C3.", vbExclamation
        Exit Sub
    End If
    
    On Error Resume Next
    Set wsOrigen = ThisWorkbook.Sheets(hojaSel)
    On Error GoTo ErrHandler
    If wsOrigen Is Nothing Then
        MsgBox "La hoja '" & hojaSel & "' no existe.", vbCritical
        Exit Sub
    End If
    
    Application.ScreenUpdating = False
    Application.EnableEvents = False
    Application.Calculation = xlCalculationManual
    
    ' --- Última fila en origen ---
    ultFilaOrigen = wsOrigen.Cells(wsOrigen.Rows.Count, "C").End(xlUp).Row
    If ultFilaOrigen < 5 Then
        wsDestino.Range("C4:CK" & wsDestino.Rows.Count).ClearContents
        GoTo CleanExit
    End If
    
    ' --- Limpiar destino ---
    filaFin = wsDestino.Cells(wsDestino.Rows.Count, "E").End(xlUp).Row
    If filaFin < 4 Then filaFin = 4
    wsDestino.Range("C4:CK" & filaFin).ClearContents
    
    ' --- Copiar C5:Cn del origen en array ---
    arrOrigen = wsOrigen.Range("C5:C" & ultFilaOrigen).Value
    ReDim arrDestino(1 To UBound(arrOrigen, 1), 1 To 1)
    
    ' Convertir datos: 8 dígitos con ceros, o completo si es más largo
    For i = 1 To UBound(arrOrigen, 1)
        If IsEmpty(arrOrigen(i, 1)) Or arrOrigen(i, 1) = "" Then
            arrDestino(i, 1) = ""
        Else
            Dim valor As String
            valor = CStr(arrOrigen(i, 1))
            
            If IsNumeric(valor) Then
                ' Si es número y tiene hasta 8 dígitos ? formatear con ceros
                If Len(valor) <= 8 Then
                    arrDestino(i, 1) = Format(CDbl(valor), "00000000")
                Else
                    ' Si es número mayor a 8 dígitos ? copiar como texto exacto
                    arrDestino(i, 1) = "'" & valor
                End If
            Else
                ' Si es texto ? copiar tal cual
                arrDestino(i, 1) = valor
            End If
        End If
    Next i
    
    ' Pegar en columna E como texto
    wsDestino.Range("E4").Resize(UBound(arrDestino, 1), 1).NumberFormat = "@"
    wsDestino.Range("E4").Resize(UBound(arrDestino, 1), 1).Value = arrDestino
    
    ' Nueva última fila en destino
    filaFin = wsDestino.Cells(wsDestino.Rows.Count, "E").End(xlUp).Row
    
    ' --- Copiar fórmulas desde Maestro ---
    colIni = wsDestino.Range("C1").Column       ' C
    colFin = wsDestino.Range("CK1").Column      ' CK
    
    For col = colIni To colFin
        If col <> wsDestino.Range("E1").Column Then
            If Trim(CStr(wsDestino.Cells(1, col).Value)) <> "" Then
                formulaBase = wsMaestro.Cells(4, col).Formula
                If Len(formulaBase) > 0 Then
                    wsDestino.Range(wsDestino.Cells(4, col), wsDestino.Cells(filaFin, col)).Formula = formulaBase
                End If
            End If
        End If
    Next col
    
    MsgBox "Los Datos fueron cargados con éxito." & vbCrLf & _
           "Realice el siguiente PROCESO.", vbInformation
    
CleanExit:
    Application.Calculation = xlCalculationAutomatic
    Application.EnableEvents = True
    Application.ScreenUpdating = True
    Exit Sub
    
ErrHandler:
    MsgBox "Error: " & Err.Description, vbCritical
    Resume CleanExit
End Sub

Sub actualiza_vinculo()
'Con esto, aunque Excel haya guardado la ruta diferente, buscará cualquier vínculo que contenga "DATA.xlsm" y lo actualizará a la nueva ruta.


On Error GoTo ManejoError
    
    Dim arrLinks As Variant
    Dim i As Long
    Dim oldLink As String
    Dim newLink As String
    Dim cambios As Long
    
    newLink = "Z:\RECURSOS HUMANOS\RECURS.HUMANOS JHCR\DATA JHCR - PLAME\Planilla Sunat JHCR\PLANILLAS MENSUALES DECLARADAS"
    cambios = 0
    
    arrLinks = ActiveWorkbook.LinkSources(xlExcelLinks)
    
    If Not IsEmpty(arrLinks) Then
        For i = LBound(arrLinks) To UBound(arrLinks)
            oldLink = arrLinks(i)
            If InStr(1, oldLink, "DATA.xlsm", vbTextCompare) > 0 Then
                ActiveWorkbook.ChangeLink _
                    Name:=oldLink, _
                    NewName:=newLink, _
                    Type:=xlExcelLinks
                cambios = cambios + 1
            End If
        Next i
        
        If cambios > 0 Then
            MsgBox "Se actualizaron " & cambios & " vínculo(s) hacia: " & vbCrLf & newLink, vbInformation, "Actualización Exitosa"
        Else
            MsgBox "No se encontró ningún vínculo con el archivo DATA.xlsm.", vbExclamation, "Sin Cambios"
        End If
    Else
        MsgBox "El libro no tiene vínculos externos.", vbExclamation, "Sin Vínculos"
    End If
    
    Exit Sub
    
ManejoError:
    MsgBox "Error al intentar actualizar los vínculos: " & Err.Description, vbCritical, "Error en la Macro"
End Sub

Sub actualiza_vinculo_automatico()
    Dim fd As FileDialog
    Dim rutaSeleccionada As String
    Dim NombreArchivo As String
    Dim arrLinks As Variant
    Dim i As Long
    Dim cambios As Long
    
    ' 1. Configurar la ventana para seleccionar el archivo DATA
    Set fd = Application.FileDialog(msoFileDialogFilePicker)
    With fd
        .Title = "Seleccione el archivo DATA (ej: DATA.xlsm)"
        .Filters.Clear
        .Filters.Add "Libros de Excel", "*.xls*"
        .AllowMultiSelect = False
        
        ' Si el usuario cancela, salir de la macro
        If .Show = False Then Exit Sub
        
        rutaSeleccionada = .SelectedItems(1)
    End With
    
    ' 2. Extraer solo el nombre del archivo de la ruta completa
    NombreArchivo = Mid(rutaSeleccionada, InStrRev(rutaSeleccionada, "\") + 1)
    
    ' 3. Obtener los vínculos del libro actual
    arrLinks = ActiveWorkbook.LinkSources(xlExcelLinks)
    cambios = 0
    
    If Not IsEmpty(arrLinks) Then
        On Error Resume Next ' Evita que la macro se detenga si un vínculo está rebelde
        For i = LBound(arrLinks) To UBound(arrLinks)
            ' Si el vínculo viejo contiene el nombre del archivo seleccionado
            If InStr(1, arrLinks(i), NombreArchivo, vbTextCompare) > 0 Then
                ActiveWorkbook.ChangeLink Name:=arrLinks(i), _
                                         NewName:=rutaSeleccionada, _
                                         Type:=xlExcelLinks
                cambios = cambios + 1
            End If
        Next i
        On Error GoTo 0
        
        If cambios > 0 Then
            MsgBox "Se actualizaron " & cambios & " vínculo(s) a:" & vbCrLf & rutaSeleccionada, vbInformation, "Éxito"
        Else
            MsgBox "No se encontraron vínculos que coincidan con " & NombreArchivo, vbExclamation, "Aviso"
        End If
    Else
        MsgBox "Este libro no tiene vínculos externos.", vbCritical, "Error"
    End If
End Sub
