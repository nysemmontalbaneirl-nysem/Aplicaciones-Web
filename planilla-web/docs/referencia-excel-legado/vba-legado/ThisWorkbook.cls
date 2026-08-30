VERSION 1.0 CLASS
BEGIN
  MultiUse = -1  'True
END
Attribute VB_Name = "ThisWorkbook"
Attribute VB_GlobalNameSpace = False
Attribute VB_Creatable = False
Attribute VB_PredeclaredId = True
Attribute VB_Exposed = True
' =========================================================================
' EVENTO: APERTURA AUTOMÁTICA DEL LIBRO (ThisWorkbook)
' =========================================================================
Private Sub Workbook_Open()
    Dim wsInicio As Worksheet
    
    ' ??? Malla de seguridad: Si algo falla, salta al gestor para devolver la visibilidad a Excel
    On Error GoTo GestorApertura
    
    ' 1. Congelar el parpadeo de pantalla
    Application.ScreenUpdating = False
    
    ' 2. Referencia explícita y directa a la hoja principal (sin usar .Select)
    Set wsInicio = ThisWorkbook.Worksheets("INICIO")
    
    ' 3. Inicializar variables globales y parámetros operativos
    accesoPermitido = False
    
    ' Desactivar el indicador verde de errores para números guardados como texto
    Application.ErrorCheckingOptions.NumberAsText = False
    
    ' Ocultar hojas secundarias para mantener la privacidad
    Call OcultarHojas
    
    ' 4. Ocultar la ventana de Excel (Efecto Aplicación Standalone)
    Application.Visible = False
    
    ' 5. Liberar actualización de pantalla antes de llamar a la interfaz visual
    Application.ScreenUpdating = True
    
    ' 6. Desplegar el formulario de activación
    ' ?? NOTA: Asegúrate de que el formulario en tu proyecto se llame exactamente 'frmActivacion' o 'frmActivar'
    frmActivacion.Show
    
    Exit Sub

GestorApertura:
    ' ?? SALVAGUARDA DE EMERGENCIA:
    ' Si ocurre cualquier error, obligamos a Excel a hacerse visible de inmediato
    Application.ScreenUpdating = True
    Application.Visible = True
    
    MsgBox "Ocurrió un problema al inicializar la aplicación." & vbCrLf & _
           "Código de Error: " & Err.Number & vbCrLf & _
           "Descripción: " & Err.Description, _
           vbCritical, "Error de Inicio - Sistema de Planillas"
End Sub
'============================================================================================
'Private Sub Workbook_Open()
'On Error Resume Next
'Hoja7.Activate
'Hoja7.Unprotect Password:=",}vkq6V@X2C+8YGp?{+s"
'Call SerialNumber
'Hoja7.Protect Password:=",}vkq6V@X2C+8YGp?{+s"
'For i = 1 To Sheets.Count

'If Sheets(i).Name <> Hoja7.Name Then
'Sheets(i).Visible = xlSheetVeryHidden

'End If

'Next i

    'Sheets("INICIO").Select
    'ActiveWindow.DisplayHeadings = False
    'Sheets("BOLETA").Select
    'ActiveWindow.DisplayHeadings = True
    'Sheets("CONFIGURACIÓN").Select
    'ActiveWindow.DisplayHeadings = False


'End Sub

'Sub SerialNumber()
    'Dim oFSO As Object
    'Dim drive As Object
     
    'Set oFSO = CreateObject("Scripting.FileSystemObject")
    'Set drive = oFSO.GetDrive("C:\")
   'Range("c15").Value = Abs(drive.SerialNumber)
     
    'Set oFSO = Nothing
    'Set drive = Nothing
      'Range("c17").Activate
'End Sub
'Sub AbreFormulario1(Control As IRibbonControl)
'Form01.Show
'End Sub
'==================================================================================================

