Attribute VB_Name = "Módulo1"
Option Private Module
Sub abrir_por_ingresos()
Load UserForm1
Call abrir_por_listas("b4:c30")
UserForm1.Label1.Caption = "0100 INGRESOS"
UserForm1.Show
End Sub

Sub abrir_por_asignaciones()
Load UserForm1
Call abrir_por_listas("b33:c46")
UserForm1.Label1.Caption = "0200 INGRESOS: ASIGNACIONES"
UserForm1.Show
End Sub

Sub abrir_por_bonificaciones()
Load UserForm1
Call abrir_por_listas("b49:c61")
UserForm1.Label1.Caption = "0300 INGRESOS: BONIFICACIONES"
UserForm1.Show
End Sub


Sub abrir_por_grati_alg()
Load UserForm1
Call abrir_por_listas("b64:c70")
UserForm1.Label1.Caption = "0400 INGRESOS: GRATIFICACIONES / AGUINALDOS"
UserForm1.Show
End Sub

Sub abrir_por_indeminiza()
Load UserForm1
Call abrir_por_listas("f4:g10")
UserForm1.Label1.Caption = "0500 INGRESOS: INDEMNIZACIONES"
UserForm1.Show
End Sub

Sub abrir_por_conceptos_varios()
Load UserForm1
Call abrir_por_listas("f13:g37")
UserForm1.Label1.Caption = "0900 CONCEPTOS VARIOS"
UserForm1.Show
End Sub

Sub abrir_por_otros_conceptos()
Load UserForm1
Call abrir_por_listas("f40:g59")
UserForm1.Label1.Caption = "0100 OTROS CONCEPTOS"
UserForm1.Show
End Sub

Sub abrir_por_aportaciones()
Load UserForm1
Call abrir_por_listas("b73:c87")
UserForm1.Label1.Caption = "0600 APORTACIONES DEL TRABAJADOR / PENSIONISTA"
UserForm1.Show
End Sub

Sub abrir_por_descuentos()
Load UserForm1
Call abrir_por_listas("b90:c96")
UserForm1.Label1.Caption = "0700 DESCUENTOS AL TRABAJADOR"
UserForm1.Show
End Sub

Sub abrir_por_aportaciones_emp()
Load UserForm1
Call abrir_por_listas("b99:c109")
UserForm1.Label1.Caption = "0800 APORTACIONES DE CARGO DEL EMPLEADOR"
UserForm1.Show
End Sub

Sub Eliminar_columnas()

If Len(Cells(6, ActiveCell.Column).Value) < 2 Then Exit Sub

If Cells(1, ActiveCell.Column).Value = "ü" Then
MsgBox "El concepto que usted ha seleccionado no se puede eliminar" & Chr(13) & "Si no va usarlo simplemente no ingrese datos en dicha columna", vbCritical, "PLAME- CONCEPTOS A ELIMINAR"
Exit Sub
End If


Rpta = MsgBox("Desea eliminar el concepto: " & Cells(6, ActiveCell.Column).Value, vbYesNo, "ELIMINAR CONCEPTOS")

If Rpta = vbYes Then
ActiveCell.EntireColumn.Delete
End If


Cells(4, ActiveCell.Column).Borders(xlEdgeLeft).LineStyle = xlContinuous

End Sub


Sub abrir_por_listas(ingresos As String)
UserForm1.ListBox1.RowSource = Hoja2.Name & "!" & Range(ingresos).Address
End Sub


Sub Lista_cenceptos_horizontal(posicion As Integer)

'Range("N6").activate
'Range("e6").End(xlToRight).Offset(0, 2).activate

 Rows("2:2").Find(What:="sebas", After:=Range("c2"), LookIn _
        :=xlFormulas, LookAt:=xlPart, SearchOrder:=xlByRows, SearchDirection:= _
        xlNext, MatchCase:=False, SearchFormat:=False).Offset(4, 0).Activate


For i = 1 To posicion
ActiveCell.End(xlToRight).Offset(0, 2).Activate
Next i

'Range(ActiveCell, ActiveCell.End(xlToRight).Offset(0, -1)).activate
End Sub

Sub agregar_concepto_nolabor()

    Columns("t:u").Copy
    
    Range("r6").End(xlToRight).EntireColumn.Insert Shift:=xlToRight
    
Cells(1, Range("r6").End(xlToRight).Offset(0, -2).Column).Value = "x"
Cells(1, Range("r6").End(xlToRight).Offset(0, -1).Column).Value = "x"
Application.CutCopyMode = False

 Range(Cells(7, Range("r6").End(xlToRight).Offset(1, -2).Column), Cells(65536, Range("r6").End(xlToRight).Offset(1, -1).Column)).ClearContents
End Sub



Sub eliminar_concepto_molabor()

'Range(Cells(5, ActiveCell.Column).Offset(-2, 0), Cells(5, ActiveCell.Column).Offset(-2, 1)).EntireColumn.Delete


If Cells(1, ActiveCell.Column).Value = "ü" Then
MsgBox "El concepto que usted ha seleccionado no se puede eliminar" & Chr(13) & "Si no va usarlo simplemente no ingrese datos en dicha columna", vbCritical, "PLAME- CONCEPTOS A ELIMINAR"
Exit Sub
End If

If Cells(6, ActiveCell.Column).Value = "N° de días de suspensión de labores" Or Cells(6, ActiveCell.Column).Value = "Razón: Días no laborados" Then
Cells(5, ActiveCell.Column).Offset(-2, 0).Activate
Selection.Columns.EntireColumn.Delete
'Range(ActiveCell, ActiveCell.Offset(0, 1)).activate
End If


End Sub


Sub limpiar_todo()
Rpta = MsgBox("Esta seguro que desea eliminar toda la información registrada", vbYesNo, "ESTRUCTURAS PLAME - TRABAJADORES")
If Rpta = vbYes Then
Range("a7:iv65536").Clear
End If


End Sub

















