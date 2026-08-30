Attribute VB_Name = "Formulario_boleta"
' Crear botón automáticamente
Sub CrearBotonFormulario()
    On Error Resume Next
    Dim ws As Worksheet
    Dim btn As Button
    
    Set ws = ThisWorkbook.Sheets(1)
    ws.Buttons.Delete
    
    Set btn = ws.Buttons.Add(10, 10, 120, 30)
    With btn
        .Caption = "Consulta Trabajador"
        .OnAction = "AbrirFormularioConsulta"
        .Name = "btnConsulta"
    End With
    
    MsgBox "Botón creado exitosamente", vbInformation
End Sub
