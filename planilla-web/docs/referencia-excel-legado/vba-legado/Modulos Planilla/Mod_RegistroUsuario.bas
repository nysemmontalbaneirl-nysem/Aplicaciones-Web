Attribute VB_Name = "Mod_RegistroUsuario"
Option Private Module

' ?? Registra un usuario en la base de datos online (Google Form)
Sub Registrar_Usuario()
    Dim nombres As String, correo As String, telefono As String, ciudad As String
    Dim nombreproducto As String, serieproducto As String, passproducto As String
    Dim http As Object, url As String, params As String, Rpta As VbMsgBoxResult
    
    nombres = UCase(Range("E6").Value)
    correo = LCase(Range("E8").Value)
    telefono = Range("E10").Value
    ciudad = UCase(Range("E12").Value)
    nombreproducto = Hoja2.Range("D3").Value
    serieproducto = Hoja2.Range("G10").Value
    passproducto = Hoja2.Range("G12").Value
    
    If nombres = "" Or correo = "" Or telefono = "" Or ciudad = "" Then
        MsgBox "Los campos Nombres, Correo, Teléfono y Ciudad son obligatorios.", vbCritical, "Registro"
        End
    End If
    
    If ActiveSheet.CommandButton1.Caption = "  YA REGISTRADO" Then
        Rpta = MsgBox("Ya se ha registrado anteriormente." & vbCrLf & _
                      "¿Desea registrar a otro usuario?", vbExclamation + vbYesNo, "Registro")
        If Rpta = vbNo Then
            Range("E6:H12").ClearContents
            End
        End If
    End If
    
    On Error GoTo sininternet
    Set http = CreateObject("WinHttp.WinHttpRequest.5.1")
    url = "https://docs.google.com/forms/d/e/1FAIpQLSeedp0HPJYQLNM3VhRm81kHoIkP1Tl1I7GIO2Qv_ZDZAmVDlg/formResponse"
    params = "entry.1079252841=" & nombres & _
             "&entry.466845594=" & correo & _
             "&entry.618947510=" & telefono & _
             "&entry.662775981=" & ciudad & _
             "&entry.1508640375=" & nombreproducto & _
             "&entry.323325163=" & serieproducto & _
             "&entry.1336365816=" & passproducto
    
    http.Open "POST", url, False
    http.SetRequestHeader "Content-type", "application/x-www-form-urlencoded"
    http.Send (params)
    
    MsgBox "Información enviada. Gracias!", vbInformation, "Registro completado"
    Range("E6:H12").ClearContents
    ActiveSheet.CommandButton1.Caption = "  YA REGISTRADO"
    Exit Sub
    
sininternet:
    MsgBox "Problema de conexión a Internet. Envíe un correo a soporte.", vbCritical, "Sin conexión"
End Sub

