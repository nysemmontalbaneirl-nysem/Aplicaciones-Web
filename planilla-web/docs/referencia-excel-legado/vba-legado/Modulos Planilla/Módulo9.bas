Attribute VB_Name = "Módulo9"
Sub listar_hojas()
For i = 1 To Sheets.Count
Range("f65536").End(xlUp).Offset(1, 0).Value = Sheets(i).Name
Next i
End Sub

Sub HHH()
MsgBox Space(ActiveCell.Value)
End Sub


Sub mostrar1()

Load UserForm3
UserForm3.Show
End Sub
'''''''''''''''''''''''''''''''''''''''''''''''''''''

Sub tecla_activar()
Application.OnKey "{f3}", "mostrar1"
End Sub


Sub toas()
For i = 1 To Sheets.Count
Sheets(i).UsedRange.Font.Size = 7
Next i
End Sub


