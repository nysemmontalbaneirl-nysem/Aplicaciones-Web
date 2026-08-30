Attribute VB_Name = "AccesoSerial"
Option Private Module
Option Explicit

' =========================================================================
' MÓDULO DE LICENCIA, SEGURIDAD Y CONTROL DE HOJAS
' =========================================================================

Private m_mainWmi As Object
Private m_deviceLists As Collection
Public Serie1 As String

Private Function GetMainWMIObject() As Object
    On Error GoTo eh
    If m_mainWmi Is Nothing Then
        Set m_mainWmi = GetObject("WinMgmts:")
    End If
    Set GetMainWMIObject = m_mainWmi
    Exit Function
eh:
    Set GetMainWMIObject = Nothing
End Function

Public Function GetWmiDeviceSingleValue(ByVal WmiClass As String, ByVal WmiProperty As String) As String
    On Error GoTo done
    Dim result As String
    Dim wmiclassObjList As Object
    Set wmiclassObjList = GetWmiDeviceList(WmiClass)
    Dim wmiclassObj As Object
    
    If Not wmiclassObjList Is Nothing Then
        For Each wmiclassObj In wmiclassObjList
            result = CallByName(wmiclassObj, WmiProperty, VbGet)
            Exit For
        Next
    End If
done:
    GetWmiDeviceSingleValue = Trim(result)
End Function

Public Function GetWmiDeviceList(ByVal WmiClass As String) As Object
    If m_deviceLists Is Nothing Then
        Set m_deviceLists = New Collection
    End If
    On Error GoTo fetchNew
    Set GetWmiDeviceList = m_deviceLists.Item(WmiClass)
    Exit Function
fetchNew:
    Dim devList As Object
    Set devList = GetWmiDeviceListInternal(WmiClass)
    If Not devList Is Nothing Then
        Call m_deviceLists.Add(devList, WmiClass)
    End If
    Set GetWmiDeviceList = devList
End Function

Private Function GetWmiDeviceListInternal(ByVal WmiClass As String) As Object
    On Error GoTo eh
    Dim wmiObj As Object
    Set wmiObj = GetMainWMIObject()
    If Not wmiObj Is Nothing Then
        Set GetWmiDeviceListInternal = wmiObj.InstancesOf(WmiClass)
    Else
        Set GetWmiDeviceListInternal = Nothing
    End If
    Exit Function
eh:
    Set GetWmiDeviceListInternal = Nothing
End Function

Public Function SerieDiscoFisico() As String
    Dim temp As String
    Dim WMIService As Object, Items As Object, SubItems As Object
    On Error GoTo eh
    Set WMIService = GetObject("winmgmts:\\.\root\cimv2")
    Set Items = WMIService.ExecQuery("Select * from Win32_PhysicalMedia", , 48)
    For Each SubItems In Items
        temp = SubItems.SerialNumber
        If LenB(temp) > 0 Then Exit For
    Next
    SerieDiscoFisico = Trim(temp)
    Exit Function
eh:
    SerieDiscoFisico = ""
End Function

Public Function FSerialNumber() As String
    On Error GoTo eh
    Dim oFSO As Object
    Dim drive As Object
    Dim res As String
    Set oFSO = CreateObject("Scripting.FileSystemObject")
    Set drive = oFSO.GetDrive("C:\")
    res = CStr(Abs(drive.SerialNumber))
    FSerialNumber = res
    Set oFSO = Nothing
    Set drive = Nothing
    Exit Function
eh:
    FSerialNumber = ""
End Function

Public Function MBSerialNumber() As String
    On Error GoTo eh
    Dim objs As Object, obj As Object, WMI As Object
    Dim sAns As String
    Set WMI = GetObject("WinMgmts:")
    Set objs = WMI.InstancesOf("Win32_BaseBoard")
    For Each obj In objs
        sAns = sAns & obj.SerialNumber
    Next
    MBSerialNumber = Trim(sAns)
    Exit Function
eh:
    MBSerialNumber = ""
End Function

Function SoloesTexto(ByVal cadenaTexto2 As String) As Boolean
    Dim c As String
    Dim i As Integer
    For i = 1 To Len(cadenaTexto2)
        c = Mid(cadenaTexto2, i, 1)
        If Not c Like "[a-zA-Z]" Then
            SoloesTexto = False
            Exit Function
        End If
    Next i
    SoloesTexto = True
End Function

Function LimpiarTexto(ByVal cadenaTexto As String, sustituirPor As String) As String
    Dim tamanoCadena As Long, i As Long
    Dim cadenaResultado As String, caracteresValidos As String
    Dim caracterActual As String
    
    tamanoCadena = Len(cadenaTexto)
    If tamanoCadena > 0 Then
        caracteresValidos = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
        For i = 1 To tamanoCadena
            caracterActual = Mid(cadenaTexto, i, 1)
            If InStr(caracteresValidos, caracterActual) > 0 Then
                cadenaResultado = cadenaResultado & caracterActual
            Else
                cadenaResultado = cadenaResultado & sustituirPor
            End If
        Next
    End If
    LimpiarTexto = cadenaResultado
End Function

' =========================================================================
' OBTENCIÓN Y CÁLCULO DE SERIE DE LICENCIA
' =========================================================================

Sub ObtieneSerieReal()
    On Error Resume Next
    Call desbloquea_hoja
    Dim Tipo1 As String, Tipo2 As String, tipo3 As String, tipo4 As String
    Dim wsInicio As Worksheet
    
    Set wsInicio = ThisWorkbook.Worksheets("INICIO")
    Application.ScreenUpdating = False
    
    On Error GoTo Modo2
    Tipo1 = GetWmiDeviceSingleValue("Win32_BIOS", "SerialNumber")
    Tipo1 = LimpiarTexto(Tipo1, "")
    If TipoVa(Tipo1) = True Then Tipo1 = Tipo1 & "123"
    
    If Len(Tipo1) > 0 And SoloesTexto(Tipo1) = False Then
        wsInicio.Range("G10").Value = "A-" & Trim(Mid(Tipo1, 1, 15)) & "-"
        Call Etapa2_Serie
        Exit Sub
    Else
        GoTo Modo2
    End If
    Exit Sub

Modo2:
    On Error GoTo Modo3
    Tipo2 = MBSerialNumber()
    Tipo2 = LimpiarTexto(Tipo2, "")
    If TipoVa(Tipo2) = True Then Tipo2 = Tipo2 & "123"
    If Len(Tipo2) > 0 And SoloesTexto(Tipo2) = False Then
        wsInicio.Range("G10").Value = "B-" & Trim(Mid(Tipo2, 1, 15)) & "-"
        Call Etapa2_Serie
        Exit Sub
    Else
        GoTo Modo3
    End If
    Exit Sub

Modo3:
    On Error GoTo Modo4
    tipo3 = SerieDiscoFisico()
    tipo3 = LimpiarTexto(tipo3, "")
    If TipoVa(tipo3) = True Then tipo3 = tipo3 & "123"
    If Len(tipo3) > 0 And SoloesTexto(tipo3) = False Then
        wsInicio.Range("G10").Value = "C-" & Trim(Mid(tipo3, 1, 15)) & "-"
        Call Etapa2_Serie
        Exit Sub
    End If
    Exit Sub

Modo4:
    tipo4 = FSerialNumber()
    tipo4 = LimpiarTexto(tipo4, "")
    If TipoVa(tipo4) = True Then tipo4 = tipo4 & "123"
    wsInicio.Range("G10").Value = "D-" & Trim(Mid(tipo4, 1, 15)) & "-"
    Call Etapa2_Serie
    Exit Sub
End Sub

Sub Etapa2_Serie()
    Dim N_Serie As String, Neto As String, SerieGenerada As String
    Dim cuenta As Long, X As Integer, Y As Integer, z As Integer
    Dim wsInicio As Worksheet
    
    Set wsInicio = ThisWorkbook.Worksheets("INICIO")
    
    If wsInicio.Range("G10").Value = "" Then
        MsgBox "Su PC tiene un problema para obtener el ID de hardware. Contacte al soporte.", vbCritical, "Error de Serie"
        Exit Sub
    End If
    
    N_Serie = wsInicio.Range("G10").Value
    X = InStr(3, N_Serie, "-")
    Neto = Mid(N_Serie, 3, X - 3)
    Y = Len(Neto)
    z = 0
    
    If Y >= 15 Then
        Neto = Mid(Neto, 1, 15)
        GoTo brinca
    End If
    
    Do
        If z = Y Then z = 1
        Neto = Neto & Mid(Neto, Y - z, 1)
        z = z + 1
    Loop Until Len(Neto) = 15

brinca:
    With wsInicio
        SerieGenerada = Mid(.Range("G10").Value, 1, 2) & SerieFinal(Neto)
        cuenta = Application.WorksheetFunction.CountIf(.Range("M1:M20"), SerieGenerada)
        If cuenta = 0 Then
            .Range("M65536").End(xlUp).Offset(1, 0).Value = SerieGenerada
        End If
        .Range("G10").Value = SerieGenerada & "-" & .Range("N2").Value
    End With
    
    Call bloquea_hoja
    Application.ScreenUpdating = True
End Sub

Public Function SerieFinal(ByVal texto As String) As String
    Dim n As Integer, Cadena As String, dig As String
    Cadena = ""
    For n = 1 To Len(texto)
        dig = Mid(texto, n, 1)
        If IsNumeric(dig) = True Then
            Cadena = Cadena & dig
        Else
            Cadena = Cadena & (ThisWorkbook.Worksheets("INICIO").Cells(1, dig).Column + n)
        End If
    Next
    SerieFinal = Mid(Cadena, 1, 15)
End Function

Public Function Acceso(SerieRegistrada As String) As Boolean
    Dim n1 As Integer, n2 As Integer, n3 As Integer, n4 As Integer, n5 As Integer
    Dim n6 As Integer, n7 As Integer, n8 As Integer, n9 As Integer, n10 As Integer
    Dim clave As String
    Dim wsInicio As Worksheet
    
    Set wsInicio = ThisWorkbook.Worksheets("INICIO")
    
    If Len(SerieRegistrada) < 19 Then
        MsgBox "Serie de equipo no válida o incompleta.", vbCritical, "Error en Serie"
        Acceso = False
        Exit Function
    End If
    
    On Error GoTo ErrorClave
    n1 = CInt(Mid(SerieRegistrada, 3, 1))
    n2 = CInt(Mid(SerieRegistrada, 5, 1))
    n3 = CInt(Mid(SerieRegistrada, 8, 1))
    n4 = CInt(Mid(SerieRegistrada, 12, 1))
    n5 = CInt(Mid(SerieRegistrada, 16, 1))
    n6 = CInt(Mid(SerieRegistrada, 4, 1))
    n7 = CInt(Mid(SerieRegistrada, 7, 1))
    n8 = CInt(Mid(SerieRegistrada, 8, 1))
    n9 = CInt(Mid(SerieRegistrada, 11, 1))
    n10 = CInt(Mid(SerieRegistrada, 15, 1))
    
    clave = ((n1 * (n1 + 1)) - n1 + n6 + 3) _
          & ((n2 * (n2 + 1)) - n2 + n7 + 5) _
          & ((n3 * (n3 + 1)) - n3 + n8 + 8) _
          & ((n4 * (n4 + 1)) - n4 + n9 + 12) _
          & ((n5 * (n5 + 1)) - n5 + 16 + 16)
          
    If clave = Trim(wsInicio.Range("G12").Value) Then
        Acceso = True
    Else
        Acceso = False
    End If
    Exit Function

ErrorClave:
    Acceso = False
End Function

Sub desbloquea_hoja()
    On Error Resume Next
    ThisWorkbook.Worksheets("INICIO").Unprotect Password:=",}vkq6V@X2C+8YGp?{+s"
End Sub

Sub bloquea_hoja()
    On Error Resume Next
    ThisWorkbook.Worksheets("INICIO").Protect Password:=",}vkq6V@X2C+8YGp?{+s"
End Sub

Function WorksheetExists(wsName As String) As Boolean
    Dim ws As Worksheet
    WorksheetExists = False
    wsName = UCase(Trim(wsName))
    For Each ws In ThisWorkbook.Worksheets
        If UCase(Trim(ws.Name)) = wsName Then
            WorksheetExists = True
            Exit For
        End If
    Next
End Function

Sub MostrarHojas()
    Dim ws As Worksheet
    Application.ScreenUpdating = False
    On Error Resume Next
    For Each ws In ThisWorkbook.Worksheets
        If UCase(ws.Name) <> "HOJACOPIA" Then
            ws.Visible = xlSheetVisible
        Else
            ws.Visible = xlSheetVeryHidden
        End If
    Next ws
    Application.ScreenUpdating = True
End Sub

' =========================================================================
' ?? CONTROL SEGURO DE HOJAS (BLINDADO CONTRA ERROR 1004)
' =========================================================================
Sub OcultarHojas()
    Dim ws As Worksheet
    
    On Error Resume Next
    Application.ScreenUpdating = False
    
    ' 1. Asegurar que la hoja "INICIO" esté visible PRIMERO
    If WorksheetExists("INICIO") Then
        ThisWorkbook.Worksheets("INICIO").Visible = xlSheetVisible
        
        ' 2. Ocultar el resto de las hojas usando ThisWorkbook
        For Each ws In ThisWorkbook.Worksheets
            If UCase(ws.Name) <> "INICIO" Then
                ws.Visible = xlSheetVeryHidden
            End If
        Next ws
    Else
        MsgBox "No se encontró la hoja 'INICIO'. Verifique el libro.", vbCritical, "Error de Sistema"
    End If
    
    Application.ScreenUpdating = True
End Sub

Function TipoVa(ByVal SerieTipo As String) As Boolean
    Dim c As Integer, i As Integer
    If Len(SerieTipo) >= 2 And IsNumeric(SerieTipo) Then
        For i = 1 To (Len(SerieTipo) - 1)
            c = Mid(SerieTipo, i, 1)
            If c = Mid(SerieTipo, i + 1, 1) Then
                TipoVa = True
            Else
                TipoVa = False
                Exit For
            End If
        Next i
    Else
        TipoVa = False
    End If
End Function

Sub restablece()
    Dim ws As Worksheet
    For Each ws In ThisWorkbook.Worksheets
        ws.Visible = xlSheetVisible
    Next ws
End Sub

Sub revision()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Worksheets("INICIO")
    
    If ws Is Nothing Then
        MsgBox "Archivo dañado - contacte al proveedor.", vbCritical, "ERROR GRAVE"
        Exit Sub
    End If

    If Acceso(ws.Range("G10").Value) = False Then
        MsgBox "Debe ingresar una contraseña válida en la hoja INICIO", vbCritical, "ERROR DE IDENTIFICACIÓN"
        Call OcultarHojas
        Exit Sub
    End If
End Sub

