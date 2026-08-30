Attribute VB_Name = "optieneserie_creaformula"
Option Private Module
#If VBA7 And Win64 Then

Private Type BrowseInfo ' used by the function GetFolderName
    hOwner As LongPtr
    pidlRoot As LongPtr
    pszDisplayName As String
    lpszTitle As String
    ulFlags As LongPtr
    lpfn As LongPtr
    lParam As LongPtr
    iImage As LongPtr
End Type


    'Si es de 64 bits
Private Declare PtrSafe Function SHGetPathFromIDList Lib "shell32.dll" _
    Alias "SHGetPathFromIDListA" (ByVal pidl As LongPtr, ByVal pszPath As String) As LongPtr
Private Declare PtrSafe Function SHBrowseForFolder Lib "shell32.dll" _
    Alias "SHBrowseForFolderA" (lpBrowseInfo As BrowseInfo) As LongPtr
    
    #Else
    'Si es de 32 bits
    
    
Private Type BrowseInfo ' used by the function GetFolderName
    hOwner As Long
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
    Alias "SHBrowseForFolderA" (lpBrowseInfo As BROWSEINFO) As Long
    #End If
    

Function GetFolderName(Msg As String) As String
' returns the name of the folder selected by the user
#If VBA7 And Win64 Then
    'Si es de 64 bits
Dim bInfo As BrowseInfo, path As String, r As LongPtr
Dim X As LongPtr, pos As Integer
    #Else
    'Si es de 32 bits
    Dim bInfo As BrowseInfo, path As String, r As Long
Dim X As Long, pos As Integer
    #End If
    
    
    bInfo.pidlRoot = 0& ' Root folder = Desktop
    If IsMissing(Msg) Then
        bInfo.lpszTitle = "Seleccione una Carpeta"
        ' the dialog title
    Else
        bInfo.lpszTitle = "¿En que carpeta desea guardar el Archivo a generar?" ' the dialog title
    End If
    bInfo.ulFlags = &H1 ' Type of directory to return
    
    X = SHBrowseForFolder(bInfo) ' display the dialog
    ' Parse the result
    path = Space$(512)
    r = SHGetPathFromIDList(ByVal X, ByVal path)
    If r Then
        pos = InStr(path, Chr$(0))
        GetFolderName = Left(path, pos - 1) & "\"
        
       If Right(GetFolderName, 2) = "\\" Then GetFolderName = Left(GetFolderName, Len(GetFolderName) - 1)
    
    Else
        GetFolderName = ""
    End If
End Function
Sub testgetfoldername()
Dim FolderName As String
    FolderName = GetFolderName("Select a folder")
    If FolderName = "" Then
        MsgBox "No has seleccionado una carpeta válida"
         Range("C7").Value = "C:\"
    Else
      Range("C7").Value = FolderName
    End If
End Sub
Sub crear_formulas()

pp = 5
For i = 4 To 9
If IsNumeric(Cells(pp, i).Value) Then
'form = "texto(" & "'" & ActiveSheet.Name & "'!" & Cells(pp + 2, i).Address(0, 0) & "," & "repetir(0," & "'" & ActiveSheet.Name & "'!" & Cells(pp, i).Address & "))" & "&" & Chr(34) & "|" & Chr(34) & "&"
form = "SI(" & "'" & ActiveSheet.Name & "'!" & Cells(pp + 2, i).Address(0, 0) & "=" & Chr(34) & "" & Chr(34) & "," & Chr(34) & "" & Chr(34) & "," & "texto(" & "'" & ActiveSheet.Name & "'!" & Cells(pp + 2, i).Address(0, 0) & "," & "repetir(0," & "'" & ActiveSheet.Name & "'!" & Cells(pp, i).Address & ")))" & "&" & Chr(34) & "|" & Chr(34) & "&"
Else
'FORM="texto(" & "'" & ActiveSheet.Name & "'!" & Cells(pp + 2, i).Address(0, 0) & "," & "'" & ActiveSheet.Name & "'!" & Cells(pp, i).Address & ")" & "&" & Chr(34) & "|" & Chr(34) & "&"
form = "SI(" & "'" & ActiveSheet.Name & "'!" & Cells(pp + 2, i).Address(0, 0) & "=" & Chr(34) & "" & Chr(34) & "," & Chr(34) & "" & Chr(34) & "," & "texto(" & "'" & ActiveSheet.Name & "'!" & Cells(pp + 2, i).Address(0, 0) & "," & "'" & ActiveSheet.Name & "'!" & Cells(pp, i).Address & "))" & "&" & Chr(34) & "|" & Chr(34) & "&"
End If
ActiveCell.Value = ActiveCell.Value & form
Next i

End Sub



