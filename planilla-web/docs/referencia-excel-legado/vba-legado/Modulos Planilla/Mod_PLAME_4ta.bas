Attribute VB_Name = "Mod_PLAME_4ta"
Option Explicit

'======================================================
' Optimizado por ChatGPT – versión rápida y estable
'======================================================

Sub Procesar_4ta()
    Dim t As Double
    t = Timer
    
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual
    Application.EnableEvents = False
    
    Call Generar_Info_4ta
    Call Exportar_Archivo_PLAME("A65536", "A2:A", "G7", "Personal 4ta Categoría - Información")
    Call Generar_Comprobantes_4ta
    Call Exportar_Archivo_PLAME("B65536", "B2:B", "D7", "Personal 4ta Categoría - Detalle de comprobantes")
    
    Application.ScreenUpdating = True
    Application.Calculation = xlCalculationAutomatic
    Application.EnableEvents = True
    
    MsgBox "Proceso completado en " & Format(Timer - t, "0.00") & " segundos.", vbInformation, "Recibos por Honorarios - Detalle"
End Sub

'======================================================
' Genera la información principal de 4ta Categoría
'======================================================
Sub Generar_Info_4ta()
    Dim ws As Worksheet, dest As Worksheet
    Dim Data As Variant, outArr() As String
    Dim z As Long, k As Long, i As Long
    Dim dato As Variant, une As String
    
    Set ws = ThisWorkbook.ActiveSheet
    Set dest = Hoja52
    
    z = ws.Cells(ws.Rows.Count, "C").End(xlUp).Row
    If z <= 12 Then Exit Sub
    
    dest.Columns("A:A").ClearContents
    Data = ws.Range("C13:M" & z).Value ' C a M = 11 columnas
    ReDim outArr(1 To UBound(Data, 1), 1 To 1)
    
    Dim formatoI11 As String, formatoJ11 As String
    formatoI11 = ws.Range("I11").Text
    formatoJ11 = ws.Range("J11").Text
    
    For k = 1 To UBound(Data, 1)
        une = ""
        For i = 1 To 11
            dato = Data(k, i)
            Select Case i
                Case 1
                    dato = Format(dato, "00")
                Case 2
                    If Data(k, 1) = 4 Then
                        dato = Format(dato, "000000000")
                    Else
                        dato = Format(dato, "00000000")
                    End If
                Case 3, 9, 10
                    dato = Format(dato, "0")
                Case 4
                    dato = Format(dato, "000")
                Case 5
                    dato = Format(dato, "0000000")
                Case 6
                    dato = Format(dato, "0.00")
                Case 7
                    dato = Format(dato, formatoI11)
                Case 8
                    dato = Format(dato, formatoJ11)
                Case 11
                    If Data(k, 10) < 3 Then
                        dato = Format(dato, "0.00")
                    Else
                        dato = ""
                    End If
            End Select
            une = une & "|" & dato
        Next i
        outArr(k, 1) = Mid(une, 2) & "|"
    Next k
    
    dest.Range("A2").Resize(UBound(outArr, 1)).Value = outArr
End Sub

'======================================================
' Genera los comprobantes de 4ta Categoría
'======================================================
Sub Generar_Comprobantes_4ta()
    Dim ws As Worksheet, dest As Worksheet
    Dim Data As Variant, outArr() As String
    Dim z As Long, k As Long
    Dim tipodocn As String, une As String
    
    Set ws = ThisWorkbook.ActiveSheet
    Set dest = Hoja52
    
    z = ws.Cells(ws.Rows.Count, "C").End(xlUp).Row
    If z <= 12 Then Exit Sub
    
    dest.Columns("B:B").ClearContents
    Data = ws.Range("C13:P" & z).Value ' Incluye columnas necesarias
    ReDim outArr(1 To UBound(Data, 1), 1 To 1)
    
    For k = 1 To UBound(Data, 1)
        une = "|" & Format(Data(k, 13), "0") & "|" & Format(Data(k, 14), "0") ' columnas O y P
        
        If Data(k, 1) = 4 Then
            tipodocn = Format(Data(k, 2), "000000000")
        Else
            tipodocn = Format(Data(k, 2), "00000000")
        End If
        
        outArr(k, 1) = Format(Data(k, 1), "00") & "|" & _
                       tipodocn & "|" & _
                       "OPCIONAL|OPCIONAL|OPCIONAL" & une & "|"
    Next k
    
    dest.Range("B2").Resize(UBound(outArr, 1)).Value = outArr
End Sub

'======================================================
' Exporta archivo PLAME a TXT
'======================================================
Sub Exportar_Archivo_PLAME(rangoFinal As String, rangoDatos As String, celdaDestino As String, titulo As String)
    Dim ruta As String, archivo As String, f As Integer
    Dim z As Long, arr As Variant, i As Long
    
    Dim ws As Worksheet
    Set ws = Hoja52
    
    z = ws.Range(rangoFinal).End(xlUp).Row
    If z < 2 Then Exit Sub
    
    ruta = ws.Parent.Sheets("PS 4TA CATEGORÍA").Range("D6").Value
    archivo = ws.Parent.Sheets("PS 4TA CATEGORÍA").Range(celdaDestino).Value
    
    arr = ws.Range(rangoDatos & z).Value
    f = FreeFile
    Open ruta & "\" & archivo For Output As #f
    For i = 1 To UBound(arr, 1)
        Print #f, arr(i, 1)
    Next i
    Close #f
    
    MsgBox "Archivo generado:" & vbCrLf & titulo & vbCrLf & _
           "Ubicación: " & ruta & "\" & archivo, vbInformation, "Prestadores Servicios - Rentas 4ta"
End Sub

' Limpia la información
Sub Limpiar_Info_4ta()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets("PS 4TA CATEGORÍA")
    
    If MsgBox("¿Está seguro de eliminar la información registrada?", vbYesNo + vbQuestion, "PLAME - 4TA CATEGORÍA") = vbYes Then
        On Error Resume Next
        ws.Unprotect ",}vkq6V@X2C+8YGp?{+s"
        On Error GoTo 0
        
        ws.Rows("13:5536").ClearContents
        
        ws.Protect ",}vkq6V@X2C+8YGp?{+s"
    End If
End Sub
