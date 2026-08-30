Attribute VB_Name = "Mod_SeleccionCarpeta"

Option Private Module

#If VBA7 And Win64 Then
    Private Type BrowseInfo
        hwndOwner As LongPtr
        pidlRoot As LongPtr
        pszDisplayName As String
        lpszTitle As String
        ulFlags As LongPtr
        lpfn As LongPtr
        lParam As LongPtr
        iImage As LongPtr
    End Type

    Private Declare PtrSafe Function SHGetPathFromIDList Lib "shell32.dll" _
        Alias "SHGetPathFromIDListA" (ByVal pidl As LongPtr, ByVal pszPath As String) As LongPtr

    Private Declare PtrSafe Function SHBrowseForFolder Lib "shell32.dll" _
        Alias "SHBrowseForFolderA" (lpBrowseInfo As BrowseInfo) As LongPtr
#Else
    Private Type BrowseInfo
        hwndOwner As Long
        pidlRoot As Long
        pszDisplayName As String
        lpszTitle As String
        ulFlags As Long
        lpfn As Long
        lParam As Long
        iImage As Long
    End Type

    Private Declare Function SHGetPathFromIDList Lib "shell32.dll" _
        Alias "SHGetPathFromIDListA" (ByVal pidl As Long, ByVal pszPath As String) As Long

    Private Declare Function SHBrowseForFolder Lib "shell32.dll" _
        Alias "SHBrowseForFolderA" (lpBrowseInfo As BrowseInfo) As Long
#End If


Function SeleccionarCarpeta(Optional titulo As String) As String
    #If VBA7 And Win64 Then
        Dim bi As BrowseInfo, path As String, pidl As LongPtr
        Dim res As LongPtr, pos As Integer
    #Else
        Dim bi As BrowseInfo, path As String, pidl As Long
        Dim res As Long, pos As Integer
    #End If

    bi.hwndOwner = 0&
    If IsMissing(titulo) Then
        bi.lpszTitle = "Seleccione una Carpeta"
    Else
        bi.lpszTitle = titulo
    End If

    bi.ulFlags = &H1
    res = SHBrowseForFolder(bi)
    path = Space$(512)
    pidl = SHGetPathFromIDList(ByVal res, ByVal path)

    If pidl Then
        pos = InStr(path, Chr$(0))
        SeleccionarCarpeta = Left(path, pos - 1) & "\"
        If Right(SeleccionarCarpeta, 2) = "\\" Then
            SeleccionarCarpeta = Left(SeleccionarCarpeta, Len(SeleccionarCarpeta) - 1)
        End If
    Else
        SeleccionarCarpeta = ""
    End If
End Function


Sub Test_SeleccionarCarpeta()
    Dim ruta As String
    ruta = SeleccionarCarpeta("¿En qué carpeta desea guardar el archivo?")
    If ruta = "" Then
        MsgBox "No has seleccionado una carpeta válida"
        Range("D6").Value = "C:\"
    Else
        Range("D6").Value = ruta
    End If
End Sub

