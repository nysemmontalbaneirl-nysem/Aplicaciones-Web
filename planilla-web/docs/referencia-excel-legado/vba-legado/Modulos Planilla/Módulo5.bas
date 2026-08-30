Attribute VB_Name = "Módulo5"
Sub Ocultar()
    With ActiveWindow
        .DisplayGridlines = False
        .DisplayHeadings = False
        .DisplayWorkbookTabs = True
    End With
End Sub
Sub inicio()
    Sheets("INICIO").Select
    Range("C17").Select
    Ocultar
 
Call tecla_oculta

Hoja7.Select
Hoja7.Unprotect Password:=",}vkq6V@X2C+8YGp?{+s"
Call SerialNumber
Hoja7.Protect Password:=",}vkq6V@X2C+8YGp?{+s"
End Sub
    
Sub bsc190()
    ActiveWindow.DisplayWorkbookTabs = True
End Sub
Sub Guardar()
    ActiveWorkbook.Save
    ActiveWorkbook.Close SaveChanges:=True
End Sub

Sub Ocultar1()
    With ActiveWindow
        .DisplayGridlines = True
        .DisplayHeadings = True
        .DisplayWorkbookTabs = True
    End With
End Sub

Sub SerialNumber()
    Dim oFSO As Object
    Dim drive As Object
     
    Set oFSO = CreateObject("Scripting.FileSystemObject")
    Set drive = oFSO.GetDrive("C:\")
   Range("C15").Value = Abs(drive.SerialNumber)
     
    Set oFSO = Nothing
    Set drive = Nothing
          
End Sub

Sub tecla_oculta()
Application.OnKey "{ESC}", "ocultar"

End Sub

Function BUSCARV2(valor1, valor2, area As Range, columna As Integer)
Dim i As Long
Dim resultado As Variant
Dim dim1 As Integer
Dim dim2 As Integer
'dim1 guarda la cantidad de filas del area
dim1 = area.Rows.Count
'dim2 guarda la cantidad de columnas del area
dim2 = area.Columns.Count

For i = 1 To dim1
If area.Cells(i, 1).Value = valor1 Then
If area.Cells(i, 2).Value = valor2 Then
resultado = area.Cells(i, columna).Value
Exit For
End If
End If
Next i
BUSCARV2 = resultado
End Function

Function BUSCARV3(valor1, valor2, area As Range, columna As Integer)
    Dim i As Long
    Dim resultado As Variant
    Dim dim1 As Integer
    Dim dim2 As Integer
    'dim1 guarda la cantidad de filas del area
    dim1 = area.Rows.Count
    'dim2 guarda la cantidad de columnas del area
    dim2 = area.Columns.Count

    For i = 1 To dim1
        If area.Cells(i, 1).Value = valor1 Then
            If area.Cells(i, 10).Value = valor2 Then
                resultado = area.Cells(i, columna).Value
                Exit For
            End If
        End If          ' <<-- falta esta línea en tu versión original
    Next i
    BUSCARV3 = resultado
End Function

