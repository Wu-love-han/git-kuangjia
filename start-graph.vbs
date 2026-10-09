' Graph framework launcher: start the local server hidden, then open the editor.
'
' ASCII-only on purpose (wscript reads .vbs with the system ANSI code page), and
' the Chinese node path is assembled with ChrW at runtime so no non-ASCII byte
' ever lives in this file:
'   D:\AI<U+9A71><U+52A8><U+76D8>\Deepseek\node.exe
Option Explicit
Dim fso, sh, root, nodeExe, server, candidates, i
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = root
candidates = Array( _
  "D:\AI" & ChrW(&H9A71) & ChrW(&H52A8) & ChrW(&H76D8) & "\Deepseek\node.exe", _
  "D:\AI" & ChrW(&H9A71) & ChrW(&H52A8) & ChrW(&H76D8) & "\Deep Harness\resources\app\node_modules\electron\dist\electron.exe", _
  "node" _
)
nodeExe = "node"
For i = 0 To UBound(candidates)
  If fso.FileExists(candidates(i)) Then
    nodeExe = candidates(i)
    Exit For
  End If
Next
server = root & "\app\server.mjs"
If Not fso.FileExists(server) Then
  MsgBox "app\server.mjs is missing next to this launcher.", 16, "Graph framework"
  WScript.Quit 1
End If
sh.Run """" & nodeExe & """ """ & server & """", 0, False
WScript.Sleep 1000
sh.Run "http://127.0.0.1:43110/", 1, False
