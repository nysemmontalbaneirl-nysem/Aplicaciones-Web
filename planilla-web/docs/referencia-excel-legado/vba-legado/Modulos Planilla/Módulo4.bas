Attribute VB_Name = "Módulo4"
Option Private Module
Sub salir()
ActiveWorkbook.Saved = True 'considera que el libro activo está grabado
Application.DisplayAlerts = False 'Evita que se muestren mensajes del sistema
Application.Quit 'Cierra la aplicación
End Sub

Sub ocultar_columnas()
On Error Resume Next
Application.ScreenUpdating = False
With Hoja6

If .Range("a14").Value = FALSO Then
Hoja4.Columns("f:g").Hidden = True
Else
Hoja4.Columns("f:g").Hidden = False
End If

If .Range("a15").Value = FALSO Then
Hoja4.Columns("H:K").Hidden = True
Else
Hoja4.Columns("H:K").Hidden = False
End If

If .Range("a16").Value = FALSO Then
Hoja4.Columns("L:M").Hidden = True
Else
Hoja4.Columns("L:M").Hidden = False
End If

If .Range("a17").Value = FALSO Then
Hoja4.Columns("N:Q").Hidden = True
Else
Hoja4.Columns("N:Q").Hidden = False
End If


If .Range("a18").Value = FALSO Then
Hoja4.Columns("R:S").Hidden = True
Else
Hoja4.Columns("R:S").Hidden = False
End If

z = Hoja4.Range("u6").End(xlToRight).Column + 1

'z1 = Hoja4.Range("e6").End(xlToRight).Column
'MsgBox z1


Z1 = Rows("2:2").Find(What:="sebas", After:=Range("c2"), LookIn _
        :=xlFormulas, LookAt:=xlPart, SearchOrder:=xlByRows, SearchDirection:= _
        xlNext, MatchCase:=False, SearchFormat:=False).Offset(0, -2).Column

''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''
If .Range("a19").Value = FALSO Then


Hoja4.Shapes("7 Imagen_").Visible = False
Hoja4.Shapes("6 Imagen_").Visible = False

Range(Hoja4.Cells(6, "t"), Hoja4.Cells(6, Z1)).EntireColumn.Hidden = True

Else

Hoja4.Shapes("7 Imagen_").Visible = True
Hoja4.Shapes("6 Imagen_").Visible = True
Range(Hoja4.Cells(6, "t"), Hoja4.Cells(6, Z1)).EntireColumn.Hidden = False
End If
''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''


zz = Hoja4.Range("iv1").End(xlToLeft).Column - 1



If .Range("a20").Value = FALSO Then

Dim myshape As Shape
    For Each myshape In ActiveSheet.Shapes
            If myshape.Name = "7 Imagen" Or myshape.Name = "6 Imagen" Then
        myshape.Visible = False
        End If
        Next myshape
        
   Range(Hoja4.Cells(6, Z1 + 2), Hoja4.Cells(6, zz)).EntireColumn.Hidden = True
   
Else

  For Each myshape In ActiveSheet.Shapes
            If myshape.Name = "7 Imagen" Or myshape.Name = "6 Imagen" Then
        myshape.Visible = True
        End If
        
      Range(Hoja4.Cells(6, Z1 + 2), Hoja4.Cells(6, zz)).EntireColumn.Hidden = False
        Next myshape
End If
End With
Application.ScreenUpdating = True
End Sub



Sub prueba1000()
z11 = Rows("2:2").Find(What:="sebas", After:=Range("c2"), LookIn _
        :=xlFormulas, LookAt:=xlPart, SearchOrder:=xlByRows, SearchDirection:= _
        xlNext, MatchCase:=False, SearchFormat:=False).Offset(0, -2).Address

MsgBox z11
End Sub



