; CacheSweep 单一安装程序（Inno Setup 6）
;
; 产物：一个 CacheSweep-Setup.exe，用户双击即可安装，
; 自动创建开始菜单和桌面快捷方式，可选开机自启（由应用内设置控制）。

#define MyAppName "CacheSweep"
#define MyAppVersion "1.0.3"
#define MyAppPublisher "君臨天下"
#define MyAppExeName "CacheSweep.exe"
#define MyAppAssocName MyAppName + " 设置"
#define MySourceRoot "..\artifacts\package"
#define MyOutputRoot "..\artifacts\dist"

[Setup]
; 签名后的编译器警告；未签名版本会提示，可忽略。
AppId={{8F2B6A1C-9D44-4E2B-9C3E-3A7D2B5F1E0A}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
; 安装到用户目录，避免触发 UAC 提权（应用本身不需要管理员）。
PrivilegesRequired=lowest
; 产物是一个 exe。
OutputDir={#MyOutputRoot}
OutputBaseFilename=CacheSweep-Setup-v{#MyAppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; 语言与图标。
SetupIconFile={#MySourceRoot}\Assets\cachesweep.ico
UninstallDisplayIcon={app}\CacheSweep.exe
UninstallDisplayName={#MyAppName}
VersionInfoVersion={#MyAppVersion}
VersionInfoProductName={#MyAppName}
VersionInfoDescription=Windows 磁盘体检与安全清理工具
; 托盘程序，默认以后台常驻方式运行。
CloseApplications=yes
RestartApplications=no

[Languages]
; 安装器界面语言。应用本身内置中英俄三语，安装后在设置里切换。
Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "在桌面创建快捷方式"; GroupDescription: "附加任务："; Flags: checkedonce

[Files]
; 整个发布目录原样安装。
Source: "{#MySourceRoot}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\卸载 {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
; 安装完成后运行程序（可选）。
Filename: "{app}\{#MyAppExeName}"; Description: "立即运行 {#MyAppName}"; Flags: nowait postinstall skipifsilent

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    // 安装成功，无需额外步骤。
  end;
end;