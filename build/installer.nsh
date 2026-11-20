; YARC - NSIS hooks included by electron-builder (electron-builder.yml -> nsis.include).
;
; Registers YARC as a *browser* for the current user (HKCU, no admin), the same layout
; Chrome/Firefox per-user installs use, so Windows lists it under
; Settings > Apps > Default apps and in "Open with" for http/https links and .html/.htm files.
;
; It deliberately does NOT make itself the default: Windows 10/11 protect UserChoice, so the
; app opens ms-settings:defaultapps?registeredAppUser=Arc%20Shell itself and the user picks it.
; The RegisteredApplications value name below ("${PRODUCT_NAME}" = "YARC") must stay equal to
; that registeredAppUser value.
;
; Provided by electron-builder's templates: $appExe (full path of the installed exe),
; SHELL_CONTEXT (HKCU for this per-user install), ${PRODUCT_NAME}, ${isUpdated}.
;
; The commands use "--" before "%1" so a crafted URL can never be parsed as a Chromium/Electron
; command-line switch (Chromium stops switch parsing at "--"). The app reads the URL/file path as
; the last argv entry.

!define ARCSHELL_CLIENT_KEY "Software\Clients\StartMenuInternet\ArcShell"
!define ARCSHELL_URL_PROGID "ArcShellURL"
!define ARCSHELL_HTML_PROGID "ArcShellHTML"

!macro customInstall
  ; --- ProgID for web links (http/https) ---
  WriteRegStr SHELL_CONTEXT "Software\Classes\${ARCSHELL_URL_PROGID}" "" "${PRODUCT_NAME} URL"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${ARCSHELL_URL_PROGID}" "URL Protocol" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\${ARCSHELL_URL_PROGID}" "FriendlyTypeName" "${PRODUCT_NAME} URL"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${ARCSHELL_URL_PROGID}\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${ARCSHELL_URL_PROGID}\shell" "" "open"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${ARCSHELL_URL_PROGID}\shell\open\command" "" '"$appExe" -- "%1"'

  ; --- ProgID for local HTML documents (.html/.htm) ---
  WriteRegStr SHELL_CONTEXT "Software\Classes\${ARCSHELL_HTML_PROGID}" "" "${PRODUCT_NAME} HTML Document"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${ARCSHELL_HTML_PROGID}" "FriendlyTypeName" "${PRODUCT_NAME} HTML Document"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${ARCSHELL_HTML_PROGID}\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${ARCSHELL_HTML_PROGID}\shell" "" "open"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${ARCSHELL_HTML_PROGID}\shell\open\command" "" '"$appExe" -- "%1"'

  ; Offer YARC in "Open with" for .html/.htm without stealing the current default.
  WriteRegNone SHELL_CONTEXT "Software\Classes\.html\OpenWithProgids" "${ARCSHELL_HTML_PROGID}"
  WriteRegNone SHELL_CONTEXT "Software\Classes\.htm\OpenWithProgids" "${ARCSHELL_HTML_PROGID}"

  ; --- Browser client + capabilities (what Default apps reads) ---
  WriteRegStr SHELL_CONTEXT "${ARCSHELL_CLIENT_KEY}" "" "${PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "${ARCSHELL_CLIENT_KEY}\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "${ARCSHELL_CLIENT_KEY}\shell\open\command" "" '"$appExe"'
  WriteRegStr SHELL_CONTEXT "${ARCSHELL_CLIENT_KEY}\Capabilities" "ApplicationName" "${PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "${ARCSHELL_CLIENT_KEY}\Capabilities" "ApplicationDescription" "${PRODUCT_NAME} - an open-source web browser"
  WriteRegStr SHELL_CONTEXT "${ARCSHELL_CLIENT_KEY}\Capabilities" "ApplicationIcon" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "${ARCSHELL_CLIENT_KEY}\Capabilities\StartMenu" "StartMenuInternet" "ArcShell"
  WriteRegStr SHELL_CONTEXT "${ARCSHELL_CLIENT_KEY}\Capabilities\URLAssociations" "http" "${ARCSHELL_URL_PROGID}"
  WriteRegStr SHELL_CONTEXT "${ARCSHELL_CLIENT_KEY}\Capabilities\URLAssociations" "https" "${ARCSHELL_URL_PROGID}"
  WriteRegStr SHELL_CONTEXT "${ARCSHELL_CLIENT_KEY}\Capabilities\FileAssociations" ".html" "${ARCSHELL_HTML_PROGID}"
  WriteRegStr SHELL_CONTEXT "${ARCSHELL_CLIENT_KEY}\Capabilities\FileAssociations" ".htm" "${ARCSHELL_HTML_PROGID}"
  ; The app was called Arc Shell: drop that entry so Default apps doesn't list it twice. The
  ; ArcShell* keys and ProgIDs above keep their names, so a default-browser choice survives.
  DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "Arc Shell"
  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "${PRODUCT_NAME}" "${ARCSHELL_CLIENT_KEY}\Capabilities"

  ; Shortcuts left from an Arc Shell install that is gone (its folder deleted by hand, so its
  ; uninstaller never ran). An in-place upgrade renames them itself.
  ${ifNot} ${FileExists} "$LOCALAPPDATA\Programs\arc-shell\Arc Shell.exe"
    Delete "$SMPROGRAMS\Arc Shell.lnk"
    Delete "$DESKTOP\Arc Shell.lnk"
  ${endIf}

  ; SHCNE_ASSOCCHANGED, SHCNF_IDLIST: tell Explorer/Settings the associations changed.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  ; During an in-place update the old uninstaller runs first and the new installer re-registers
  ; right after; keep the keys so a user's "default browser" choice is never disturbed.
  ${ifNot} ${isUpdated}
    DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "${PRODUCT_NAME}"
    DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "Arc Shell"
    DeleteRegKey SHELL_CONTEXT "${ARCSHELL_CLIENT_KEY}"
    DeleteRegValue SHELL_CONTEXT "Software\Classes\.html\OpenWithProgids" "${ARCSHELL_HTML_PROGID}"
    DeleteRegValue SHELL_CONTEXT "Software\Classes\.htm\OpenWithProgids" "${ARCSHELL_HTML_PROGID}"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\${ARCSHELL_HTML_PROGID}"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\${ARCSHELL_URL_PROGID}"
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
  ${endIf}
!macroend
