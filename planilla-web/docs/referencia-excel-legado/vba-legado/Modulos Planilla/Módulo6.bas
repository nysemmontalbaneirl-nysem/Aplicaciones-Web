Attribute VB_Name = "Módulo6"
Sub ConsolidarPlanillaMensualDinamica()
    Dim ws1 As Worksheet, ws2 As Worksheet, wsRes As Worksheet
    Dim nombreHoja1 As String, nombreHoja2 As String
    Dim dict As Object
    Dim i As Long, lastRow As Long
    Dim dni As String
    
    ' Definimos la hoja donde está el botón y los desplegables (ajusta el nombre si es necesario)
    Set wsRes = ThisWorkbook.Sheets("Resumen")
    
    ' Capturamos los nombres de las hojas desde tus listas desplegables
    nombreHoja1 = wsRes.Range("A3").Value
    nombreHoja2 = wsRes.Range("C3").Value
    
    ' Validación básica
    If nombreHoja1 = "" Or nombreHoja2 = "" Then
        MsgBox "Por favor, selecciona ambas quincenas en las celdas A3 y C3.", vbExclamation
        Exit Sub
    End If
    
    Set ws1 = ThisWorkbook.Sheets(nombreHoja1)
    Set ws2 = ThisWorkbook.Sheets(nombreHoja2)
    Set dict = CreateObject("Scripting.Dictionary")
    
    ' Limpiar resultados anteriores
    wsRes.Range("B4:EG500").ClearContents
    
    ' 1. Cargar primera quincena (Q1)
    lastRow = ws1.Cells(ws1.Rows.Count, "C").End(xlUp).Row
    For i = 4 To lastRow
        dni = Trim(ws1.Cells(i, "C").Value)
        If dni <> "" Then
            dict(dni) = ws1.Range("B" & i & ":EG" & i).Value
        End If
    Next i
    
    ' 2. Procesar segunda quincena (Q2)
    lastRow = ws2.Cells(ws2.Rows.Count, "C").End(xlUp).Row
    For i = 4 To lastRow
        dni = Trim(ws2.Cells(i, "C").Value)
        
        
        
        
        
        
        
        
        
        
        If dni <> "" Then
            ' Si el trabajador ya existe en Q1, aquí podrías sumar columnas
            ' Si solo quieres reemplazar/unir, dejamos que se sobrescriba o mantenga:
            dict(dni) = ws2.Range("B" & i & ":EG" & i).Value
        End If
    Next i
    
    ' 3. Volcar resultado
    i = 4
    For Each dni In dict.Keys
        wsRes.Range("B" & i & ":EG" & i).Value = dict(dni)
        i = i + 1
    Next dni
    
    MsgBox "Consolidación de " & nombreHoja1 & " y " & nombreHoja2 & " realizada con éxito.", vbInformation
End Sub
