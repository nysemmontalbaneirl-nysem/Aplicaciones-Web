Attribute VB_Name = "Generatxt"
Option Private Module
'''''''''''''''''''''''''''''''''''''''''''''''''''
' Exportación a txt ''''''''''''''''''''''''''''''
'''''''''''''''''''''''''''''''''''''''''''''''''''
Public n, n2, n3, n4, n5, n6 As Integer
Public CancelarEjecucion As Boolean

Sub exportar_txt()
    Dim totalTareas As Long, paso As Long
    Dim tInicio As Double, tFin As Double, tTotal As Double
    
    Application.ScreenUpdating = False
    Application.EnableEvents = False
    Application.DisplayAlerts = False
    
    ' Contar tareas seleccionadas
    totalTareas = ContarTareasSeleccionadas
    If totalTareas = 0 Then
        MsgBox "No hay tareas seleccionadas para exportar.", vbExclamation
        GoTo Salida
    End If
    
    ' Cronómetro
    tInicio = Timer
    
    ' Mostrar UserForm de progreso
    CancelarEjecucion = False    ' reset cancelación
    ufProgreso.lblAvance.Width = 0
    ufProgreso.lblPorcentaje.Caption = "0%"
    ufProgreso.lbltext.Caption = "Preparando exportación..."
    ufProgreso.Show vbModeless
    DoEvents
    
    paso = 0
    
    ' --- OR5 ---
    If Hoja6.Range("A14").Value = True Then
        paso = paso + 1
        ufProgreso.lbltext.Caption = "Exportando OR5..."
        DoEvents
        If CancelarEjecucion Then GoTo fin
        informacion_or5
        ActualizarProgreso paso, totalTareas
    End If
    
    ' --- TOC ---
    If Hoja6.Range("A15").Value = True Then
        paso = paso + 1
        ufProgreso.lbltext.Caption = "Exportando TOC..."
        DoEvents
        If CancelarEjecucion Then GoTo fin
        informacion_toc
        ActualizarProgreso paso, totalTareas
    End If
    
    ' --- TAS ---
    If Hoja6.Range("A16").Value = True Then
        paso = paso + 1
        ufProgreso.lbltext.Caption = "Exportando TAS..."
        DoEvents
        If CancelarEjecucion Then GoTo fin
        informacion_tas
        ActualizarProgreso paso, totalTareas
    End If
    
    ' --- JOR ---
    If Hoja6.Range("A17").Value = True Then
        paso = paso + 1
        ufProgreso.lbltext.Caption = "Exportando JOR..."
        DoEvents
        If CancelarEjecucion Then GoTo fin
        informacion_jor
        ActualizarProgreso paso, totalTareas
    End If
    
    ' --- SNL ---
    If Hoja6.Range("A18").Value = True Or Hoja6.Range("A19").Value = True Then
        paso = paso + 1
        ufProgreso.lbltext.Caption = "Exportando SNL..."
        DoEvents
        If CancelarEjecucion Then GoTo fin
        informacion_snl
        ActualizarProgreso paso, totalTareas
    End If
    
    ' --- REM ---
    If Hoja6.Range("A20").Value = True Then
        paso = paso + 1
        ufProgreso.lbltext.Caption = "Exportando REM..."
        DoEvents
        If CancelarEjecucion Then GoTo fin
        informacion_REM
        ActualizarProgreso paso, totalTareas
    End If
    
fin:
    ' Forzar al 100% si no canceló
    If Not CancelarEjecucion Then
        ufProgreso.lblAvance.Width = ufProgreso.fraContenedor.Width
        ufProgreso.lblPorcentaje.Caption = "100%"
        DoEvents
    End If
    
    ' Tiempo total
    tFin = Timer
    tTotal = Round(tFin - tInicio, 2)
    
    If CancelarEjecucion Then
        MsgBox "Exportación cancelada por el usuario." & vbCrLf & _
               "Tareas realizadas: " & paso & " de " & totalTareas, vbExclamation
    Else
        MsgBox "Exportación finalizada" & vbCrLf & _
               "Tareas realizadas: " & paso & " de " & totalTareas & vbCrLf & _
               "Tiempo: " & tTotal & " segundos.", vbInformation
    End If
    
Salida:
    On Error Resume Next
    Unload ufProgreso
    Application.ScreenUpdating = True
    Application.EnableEvents = True
    Application.DisplayAlerts = True
End Sub

Sub informacion_jor()
    Dim ws As Worksheet, wsOut As Worksheet
    Dim arrDatos As Variant, arrOut() As String
    Dim i As Long, n4 As Long, ultimaFila As Long
    Dim totalIter As Long, progreso As Long
    Dim hay As Boolean

    Set ws = ThisWorkbook.Sheets("PLANILLA-TRABAJADORES")
    Set wsOut = Hoja3

    ultimaFila = ws.Cells(ws.Rows.Count, "C").End(xlUp).Row
    If ultimaFila < 7 Then Exit Sub

    arrDatos = ws.Range("C7:Q" & ultimaFila).Value

    wsOut.Range("A:A").ClearContents

    ReDim arrOut(1 To UBound(arrDatos, 1))

    n4 = 0
    totalIter = UBound(arrDatos, 1)

    For i = 1 To totalIter
        If CancelarEjecucion Then GoTo Cancelado

        hay = (Len(CStr(arrDatos(i, 12))) > 0) Or _
              (Len(CStr(arrDatos(i, 13))) > 0) Or _
              (Len(CStr(arrDatos(i, 14))) > 0) Or _
              (Len(CStr(arrDatos(i, 15))) > 0)

        If hay Then
            n4 = n4 + 1
            arrOut(n4) = _
                Format(arrDatos(i, 1), "00") & "|" & _
                Format(arrDatos(i, 3), "00000000") & "|" & _
                CStr(arrDatos(i, 12)) & "|" & _
                CStr(arrDatos(i, 13)) & "|" & _
                CStr(arrDatos(i, 14)) & "|" & _
                CStr(arrDatos(i, 15)) & "|"
        End If

        progreso = i
        If progreso Mod 50 = 0 Then ActualizarProgreso progreso, totalIter
    Next i

    If n4 > 0 Then
        wsOut.Range("A2").Resize(n4, 1).Value = Application.Transpose(arrOut)
        Call Guardar_txt("A65536", "A2:A", ".jor", "La jornada Laboral")
    End If
    Exit Sub

Cancelado:
    MsgBox "Proceso JOR cancelado por el usuario.", vbExclamation
End Sub

Sub informacion_or5()
    Dim ws As Worksheet, wsOut As Worksheet
    Dim Data As Variant, result() As String
    Dim i As Long, n As Long, z As Long
    
    Set ws = ThisWorkbook.Sheets("PLANILLA-TRABAJADORES")
    Set wsOut = Hoja3
    
    z = ws.Cells(ws.Rows.Count, "C").End(xlUp).Row
    Data = ws.Range("C7:G" & z).Value
    
    ReDim result(1 To UBound(Data, 1))
    n = 0
    
    For i = 1 To UBound(Data, 1)
        If Len(Data(i, 4)) > 0 Or Val(Data(i, 5)) > 0 Then
            n = n + 1
            result(n) = Format(Data(i, 1), "00") & "|" & _
                        Format(Data(i, 3), "00000000") & "|" & _
                        Data(i, 4) & "|" & _
                        Format(Data(i, 5), "0.00") & "|"
        End If
    Next i
    
    wsOut.Range("G:G").ClearContents
    If n > 0 Then
        wsOut.Range("G1").Resize(n).Value = Application.Transpose(result)
        Call Guardar_txt("G65536", "G2:G", ".or5", "Otros ingresos de quinta categoría")
    End If
End Sub

Sub informacion_toc()
    Dim ws As Worksheet, wsOut As Worksheet
    Dim Data As Variant, result() As String
    Dim i As Long, n As Long, z As Long, verificar As Long
    
    Set ws = ThisWorkbook.Sheets("PLANILLA-TRABAJADORES")
    Set wsOut = Hoja3
    
    z = ws.Cells(ws.Rows.Count, "C").End(xlUp).Row
    Data = ws.Range("C7:K" & z).Value
    
    ReDim result(1 To UBound(Data, 1))
    n = 0
    
    For i = 1 To UBound(Data, 1)
        verificar = 0
        If Len(Data(i, 6)) > 0 Then verificar = verificar + 1
        If Len(Data(i, 7)) > 0 Then verificar = verificar + 1
        If Len(Data(i, 8)) > 0 Then verificar = verificar + 1
        If Len(Data(i, 9)) > 0 Then verificar = verificar + 1
        
        If verificar > 1 Then
            n = n + 1
            result(n) = Format(Data(i, 1), "00") & "|" & _
                        Format(Data(i, 3), "00000000") & "|" & _
                        Format(Data(i, 6), "0") & "|" & _
                        Format(Data(i, 7), "0") & "|" & _
                        Format(Data(i, 8), "0") & "|" & _
                        Format(Data(i, 9), "0") & "|"
        End If
    Next i
    
    wsOut.Range("H:H").ClearContents
    If n > 0 Then
        wsOut.Range("H1").Resize(n).Value = Application.Transpose(result)
        Call Guardar_txt("H65536", "H2:H", ".toc", "Otras condiciones")
    End If
End Sub

Sub informacion_tas()
    Dim ws As Worksheet, wsOut As Worksheet
    Dim Data As Variant, result() As String
    Dim i As Long, n As Long, z As Long, verificar As Long
    
    Set ws = ThisWorkbook.Sheets("PLANILLA-TRABAJADORES")
    Set wsOut = Hoja3
    
    z = ws.Cells(ws.Rows.Count, "C").End(xlUp).Row
    Data = ws.Range("C7:M" & z).Value
    
    ReDim result(1 To UBound(Data, 1))
    n = 0
    
    For i = 1 To UBound(Data, 1)
        verificar = 0
        If Len(Data(i, 10)) > 0 Then verificar = verificar + 1
        If Len(Data(i, 11)) > 0 Then verificar = verificar + 1
        
        If verificar > 0 Then
            n = n + 1
            result(n) = Format(Data(i, 1), "00") & "|" & _
                        Format(Data(i, 3), "00000000") & "|" & _
                        Format(Data(i, 10), "0") & "|" & _
                        Format(Data(i, 11), "0.00") & "|"
        End If
    Next i
    
    wsOut.Range("I:I").ClearContents
    If n > 0 Then
        wsOut.Range("I1").Resize(n).Value = Application.Transpose(result)
        Call Guardar_txt("I65536", "I2:I", ".tas", "Tasas SCTR ESSALUD Y/O Convenio IES")
    End If
End Sub

Sub informacion_snl()
    Dim ws As Worksheet, wsOut As Worksheet
    Dim Data As Variant, result() As String
    Dim i As Long, j As Long, n As Long
    Dim hasta As Long, z As Long
    
    Set ws = ThisWorkbook.Sheets("PLANILLA-TRABAJADORES")
    Set wsOut = Hoja3
    
    ' Encontrar última fila y última columna útil
    z = ws.Cells(ws.Rows.Count, "C").End(xlUp).Row
    hasta = ws.Cells(6, ws.Columns.Count).End(xlToLeft).Column
    
    ' Leer todo el bloque (C:E + desde R hasta "hasta")
    Data = ws.Range(ws.Cells(7, "C"), ws.Cells(z, hasta)).Value
    
    ReDim result(1 To (UBound(Data, 1) * (hasta - 17) / 2))
    n = 0
    
    For i = 1 To UBound(Data, 1)
        For j = 15 To UBound(Data, 2) Step 2  ' columnas R=18 en Excel -> 15 relativo al rango
            If Len(Data(i, j)) > 0 And Len(Data(i, 1)) > 0 And Len(Data(i, 3)) > 0 Then
                n = n + 1
                result(n) = Format(Data(i, 1), "00") & "|" & _
                            Format(Data(i, 3), "00000000") & "|" & _
                            Format(Data(i, j), "00") & "|" & _
                            Format(Data(i, j + 1), "00") & "|"
            End If
        Next j
    Next i
    
    wsOut.Columns("C:C").Clear
    If n > 0 Then
        wsOut.Range("C1").Resize(n).Value = Application.Transpose(result)
        Call Guardar_txt("C65536", "C2:C", ".snl", "Días subsidiados y/o no laborados")
    End If
End Sub

Sub informacion_REM()
    Dim ws As Worksheet
    Dim Final As Long, Z1 As Long
    Dim i As Long, j As Long, n6 As Long
    Dim Datos As Variant, Salida() As String
    Dim ultCol As Long
    Dim cod As String, valor As Double
    Dim f As Range
    Dim totalIter As Long, progreso As Long
    
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual
    
    ' Hoja de origen
    Set ws = ThisWorkbook.Sheets("PLANILLA-TRABAJADORES")
    
    ' Hoja de salida (CodeName Hoja3)
    Hoja3.Columns("E:E").Clear
    
    ' Última fila en columna C
    Final = ws.Cells(ws.Rows.Count, "C").End(xlUp).Row - 6
    
    ' Buscar la primera columna donde está "sebas" en fila 2
    Set f = ws.Rows(2).Find(What:="sebas", LookIn:=xlValues, _
                LookAt:=xlWhole, SearchOrder:=xlByColumns, _
                SearchDirection:=xlNext, MatchCase:=False)
    
    If f Is Nothing Then
        MsgBox "No se encontró 'sebas' en la fila 2.", vbExclamation
        GoTo Salida
    End If
    
    Z1 = f.Column
    
    ' Última columna con datos (menos 1)
    ultCol = ws.Cells(2, ws.Columns.Count).End(xlToLeft).Column - 1
    
    ' Cargar datos en memoria
    Datos = ws.Range(ws.Cells(7, Z1), ws.Cells(Final + 6, ultCol)).Value
    
    ReDim Salida(1 To (UBound(Datos, 1) * UBound(Datos, 2))) As String
    n6 = 0
    
    ' Calcular total de iteraciones
    totalIter = UBound(Datos, 1) * UBound(Datos, 2)
    progreso = 0
    
    ' Mostrar barra de progreso
    ufProgreso.Show vbModeless
    ufProgreso.lblAvance.Width = 0
    ufProgreso.lbltext.Caption = "Iniciando..."
    DoEvents
    
    ' Recorrer matriz
    For i = 1 To UBound(Datos, 1)
        For j = 1 To UBound(Datos, 2)
            progreso = progreso + 1
            
            If Datos(i, j) <> "" And IsNumeric(Datos(i, j)) Then
                cod = UCase(ws.Cells(2, Z1 + j - 1).Value)
                valor = CDbl(Datos(i, j))
                
                n6 = n6 + 1
                Select Case cod
                    Case "D"
                        Salida(n6) = Format(ws.Cells(i + 6, 3), "00") & "|" & _
                                     Format(ws.Cells(i + 6, 5), "00000000") & "|" & _
                                     Format(ws.Cells(5, Z1 + j - 1), "0000") & "|" & _
                                     Format(valor, "0.00") & "|" & _
                                     Format(0, "0.00") & "|"
                    Case "P"
                        Salida(n6) = Format(ws.Cells(i + 6, 3), "00") & "|" & _
                                     Format(ws.Cells(i + 6, 5), "00000000") & "|" & _
                                     Format(ws.Cells(5, Z1 + j - 1), "0000") & "|" & _
                                     Format(0, "0.00") & "|" & _
                                     Format(valor, "0.00") & "|"
                    Case Else
                        Salida(n6) = Format(ws.Cells(i + 6, 3), "00") & "|" & _
                                     Format(ws.Cells(i + 6, 5), "00000000") & "|" & _
                                     Format(ws.Cells(5, Z1 + j - 1), "0000") & "|" & _
                                     Format(valor, "0.00") & "|" & _
                                     Format(valor, "0.00") & "|"
                End Select
            End If
            
            ' === actualizar barra cada 100 ciclos ===
            If progreso Mod 100 = 0 Then
                With ufProgreso
                    .lblAvance.Width = (.fraContenedor.Width) * (progreso / totalIter)
                    .lbltext.Caption = "Procesando " & Format(progreso / totalIter, "0%")
                End With
                DoEvents
            End If
        Next j
    Next i
    
    ' Volcar resultados a Hoja3
    If n6 > 0 Then
        Hoja3.Range("E2").Resize(n6, 1).Value = Application.Transpose(Salida)
        Call Guardar_txt("E" & n6 + 1, "E2:E" & n6 + 1, ".rem", "Ingresos, tributos y descuentos del trabajador")
    End If
    
Salida:
    On Error Resume Next
    Unload ufProgreso
    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True
End Sub

Sub Guardar_txt(celda_infotxt As String, rango As String, extension As String, nombre_archivo As String)
    Dim z As Long, r As Range, c As Range
    Dim sTemp As String, ruta As String, archivo As String
    
    On Error Resume Next
    z = Hoja3.Range(celda_infotxt).End(xlUp).Row
    On Error GoTo 0
    
    ruta = Hoja6.Range("C7").Value
    archivo = Hoja6.Range("F8").Value
    
    ' Validar ruta
    If Len(Dir(ruta, vbDirectory)) = 0 Then
        MsgBox "La carpeta destino no existe: " & ruta, vbCritical
        Exit Sub
    End If
    
    ' Crear archivo
    Open ruta & "\" & archivo & extension For Output As #1
    
    For Each r In Hoja3.Range(rango & z).Rows
        sTemp = ""
        For Each c In r.Cells
            sTemp = sTemp & c.Text & Chr(9)
        Next c
        While Right(sTemp, 1) = Chr(9)
            sTemp = Left(sTemp, Len(sTemp) - 1)
        Wend
        Print #1, sTemp
    Next r
    Close #1
    
    MsgBox "Se ha generado el archivo: " & archivo & extension & vbCrLf & _
           "Ubicación: " & ruta, vbInformation, "Exportación completada"
End Sub

Sub ActualizarBarra(tareasRealizadas As Long, totalTareas As Long)
    Dim porcentaje As Double
    
    porcentaje = tareasRealizadas / totalTareas
    
    With ProgressBar
        .Label1.Width = .Frame1.Width * porcentaje
        .Caption = "Progreso: " & Format(porcentaje, "0%")
    End With
    
    DoEvents
End Sub

Sub ActualizarProgreso(paso As Long, total As Long)
    With ufProgreso
        ' Ajustar ancho de la barra
        .lblAvance.Width = (.fraContenedor.Width * paso) / total
        ' Mostrar porcentaje
        .lblPorcentaje.Caption = Format(paso / total, "0%")
        DoEvents
    End With
End Sub

Public Function ContarTareasSeleccionadas() As Long
    Dim c As Long
    With Hoja6
        If .Range("A14").Value = True Then c = c + 1
        If .Range("A15").Value = True Then c = c + 1
        If .Range("A16").Value = True Then c = c + 1
        If .Range("A17").Value = True Then c = c + 1
        ' A18 y A19 cuentan como UNA sola tarea
        If (.Range("A18").Value = True) Or (.Range("A19").Value = True) Then c = c + 1
        If .Range("A20").Value = True Then c = c + 1
    End With
    ContarTareasSeleccionadas = c
End Function

' Inicializa la barra de progreso
Public Sub IniciarProgreso(totalPasos As Long)
    CancelarEjecucion = False
    ufProgreso.lbltext.Caption = "Iniciando..."
    ufProgreso.lblBarra.Width = 0
    ufProgreso.Show vbModeless
    DoEvents
End Sub

' Actualiza la barra de progreso con el texto + porcentaje
Public Sub MostrarProgreso(texto As String, paso As Long, total As Long)
    With ufProgreso
        Dim porcentaje As Double
        porcentaje = (paso / total) * 100
        If porcentaje > 100 Then porcentaje = 100
        
        .lbltext.Caption = texto & " (" & Format(porcentaje, "0") & "%)"
        .lblAvance.Width = .fraContenedor.Width * (porcentaje / 100)
        
        DoEvents
    End With
End Sub

' Cierra la barra de progreso
Public Sub CerrarProgreso()
    Unload ufProgreso
End Sub

Sub kokok()
Hoja3.Visible = xlSheetVeryHidden
Hoja2.Visible = xlSheetVeryHidden
'Columns("v:w").Delete
End Sub
