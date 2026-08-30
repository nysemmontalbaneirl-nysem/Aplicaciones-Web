Attribute VB_Name = "CodRibbon"
Option Explicit
Public ribbonUI As IRibbonUI
Public accesoPermitido As Boolean
Sub CopiaHojaModelo(control As IRibbonControl)
    
    Dim nomHojas, nombreIngresado As String
    Dim numHojas, i
    Dim existe As Boolean
    Dim ws As Worksheet
    existe = False
    numHojas = Worksheets.Count
    ReDim nomHojas(numHojas)
    i = 0
    For Each ws In Worksheets
         nomHojas(i) = ws.Name
         i = i + 1
    Next ws
    nombreIngresado = Application.InputBox(Prompt:="Escriba el nombre de la HOJA", Type:=2)
    For i = 0 To numHojas
         If nombreIngresado = nomHojas(i) Then
            existe = True
         End If
    Next i
    If existe = False Then
    MsgBox "No Existe la Hoja con el Nombre Ingresado"
    Exit Sub
    Else
         Range("A1:EG4").Select
         Selection.Copy
         Worksheets(nombreIngresado).Range("A1:EG4").PasteSpecial xlPasteAll
         Range("A5:EG500").Select
         Selection.Copy
         Worksheets(nombreIngresado).Range("A5:EG500").PasteSpecial xlPasteAll
         Application.CutCopyMode = xlCopy
         Sheets(nombreIngresado).Select
         Range("A1").Select
         End If
         
       End Sub

Sub CerrarPlanilla(control As IRibbonControl)
'
   Range("A1").Select
    With Selection.Interior
        .Pattern = xlSolid
        .PatternColorIndex = xlAutomatic
        .ThemeColor = xlThemeColorDark1
        .TintAndShade = -0.149998474074526
        .PatternTintAndShade = 0
    End With
    Cells.Select
    Selection.Copy
    Selection.PasteSpecial Paste:=xlPasteValues, Operation:=xlNone, SkipBlanks _
        :=False, Transpose:=False
    Range("A1").Select
    Application.CutCopyMode = False
End Sub

Sub AbreFormulario1(control As IRibbonControl)
Form01.Show
End Sub
Sub AbreFormulario2(control As IRibbonControl)
Form02.Show
End Sub
Sub AbreFormulario3(control As IRibbonControl)
Form04.Show
 End Sub
 Sub AbreFormulario5(control As IRibbonControl)
Form05.Show
 End Sub

Sub IR_A_inicio(control As IRibbonControl)
    ' Ir al menú principal (INICIO)
    On Error Resume Next
    
    Select Case ActiveSheet.Name
        Case "INICIO"
            ' Ya estamos en INICIO, no ocultamos nada
        Case "CONFIGURACION"
            ' Ocultar CONFIGURACION totalmente
            ActiveWindow.SelectedSheets.Visible = xlSheetVeryHidden
        Case Else
            ' Otras hojas se ocultan "normal"
            ActiveWindow.SelectedSheets.Visible = xlSheetHidden
    End Select
    
    ' Muestra INICIO
    Sheets("INICIO").Visible = xlSheetVisible
    Sheets("INICIO").Select
    Range("G12").Select
End Sub
Sub ejecutarMacroSegura()
    Form03.Show
    End Sub
Sub Boton_Ingreso(control As IRibbonControl)
    Call ObtieneSerieReal
    
    If Acceso(Sheets("INICIO").Range("G10").Value) = True Then
        accesoPermitido = True ' <- Cambiamos el estado del acceso

        MsgBox "Bienvenido, Nysem Montalban EIRL. agradece su preferencia." & Chr(10) & _
               "Si desea algún tipo de asistencia puedes escribirnos a mamssc@gmail.com", _
               vbInformation, "Bienvenido al archivo"

        Call OcultarHojas

        ' Refresca el ribbon para activar botones.
        On Error Resume Next
        If Not ribbonUI Is Nothing Then ribbonUI.Invalidate
        On Error GoTo 0
        
        ' ==========================================
        ' NUEVA FUNCIONALIDAD: LLAMAR AL FORMULARIO
        ' ==========================================
        On Error Resume Next
        Configuracion.Show
        On Error GoTo 0
        
    Else
        accesoPermitido = False ' <- No permite acceso
        MsgBox "La contraseña ingresada no es válida." & Chr(10) & _
               "Si necesita un acceso adicional o no tiene una contraseña solicite informes a mamssc@gmail.com", _
               vbCritical, "No tiene acceso al aplicativo"
        Exit Sub
    End If
End Sub

Sub Boton_salir(control As IRibbonControl)
ActiveWorkbook.Close SaveChanges:=False
End Sub
' Se ejecuta al cargar el Ribbon
Sub Ribbon_Load(ribbon As IRibbonUI)
    Set ribbonUI = ribbon
    accesoPermitido = False ' Siempre parte desactivado
End Sub

' Botón "Ingresar" siempre habilitado
Sub GetEnabledButtonIngresar(control As IRibbonControl, ByRef returnedVal)
    returnedVal = True
End Sub

' Demás botones, según estado de acceso
Sub GetEnabledOtherButtons(control As IRibbonControl, ByRef returnedVal)
    returnedVal = accesoPermitido
End Sub

Sub IR_A_BOLETA(control As IRibbonControl)
' IR AL MENU PANEL
Hoja43.Visible = xlSheetVisible
    Sheets("BOLETA_PAGO").Select
    Range("A5").Select
   End Sub
' Abre hoja para procesar planilla
Sub Proceso_planilla(control As IRibbonControl)
Hoja4.Visible = xlSheetVisible
    Sheets("PLANILLA-TRABAJADORES").Select
    Range("A1").Select
End Sub

' Abre hoja para procesar Honorarios
Sub Proceso_Honorarios(control As IRibbonControl)
Hoja7.Visible = xlSheetVisible
    Sheets("PS 4TA CATEGORÍA").Select
    Range("A1").Select
End Sub
' Abre hoja para procesar AFP
Sub Proceso_Afp(control As IRibbonControl)
Hoja71.Visible = xlSheetVisible
    Sheets("Genera_AFP").Select
    Range("D1").Select
End Sub

'Abrir Formulario Consulta
Sub AbrirFormularioConsulta(control As IRibbonControl)
    frmConsultaTrabajador.Show vbModeless
End Sub

' =========================================================================
' ?? CALLBACK RIBBON: LLAMAR AL FORMULARIO DE TRABAJADORES
' =========================================================================
Sub AbrirRegistroTrabajadores(control As IRibbonControl)
    ' 1. Blindaje de seguridad preventiva
    If accesoPermitido = False Then
        MsgBox "El sistema se encuentra bloqueado." & Chr(10) & _
               "Por favor, ingrese la clave de activación al iniciar el libro.", _
               vbCritical, "Acceso Denegado"
        Exit Sub
    End If
    
    ' 2. Cargar e inicializar el formulario de forma limpia
    On Error GoTo ErrorHandler
    frmTrabajadores.Show
    Exit Sub

ErrorHandler:
    MsgBox "Ocurrió un error al intentar abrir el formulario de trabajadores." & Chr(10) & _
           "Detalle: " & Err.Description, vbExclamation, "Error del Sistema"
End Sub
