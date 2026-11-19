; Associazioni dei file di Leggio per l'installer Windows (NSIS di electron-builder, nsis.include).
;
; Perché un file a parte: con le associazioni standard di electron-builder i .p7m ricevevano l'icona
; del programma (la stessa dei PDF) e una classe con un nome generico; in Esplora risorse i documenti
; firmati sembravano PDF. Qui:
;   - due classi (ProgID) distinte: Leggio.PDF e Leggio.FirmatoP7M;
;   - il .p7m (.m7m, .tsd) ha il SUO tipo («Documento firmato digitalmente») e la SUA icona (p7m.ico);
;   - Leggio compare in «Apri con» per tutti; diventa il programma predefinito solo se l'estensione
;     non ha già un programma (non si scavalca Dike, ArubaSign, Acrobat… già installati);
;   - alla disinstallazione si tolgono le chiavi aggiunte (e il predefinito solo se era il nostro).
; Le estensioni non vengono mai modificate: si scrive solo nel registro.

!macro LeggioClasse CLASSE DESCRIZIONE ICONA
  WriteRegStr SHELL_CONTEXT "Software\Classes\${CLASSE}" "" "${DESCRIZIONE}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${CLASSE}" "FriendlyTypeName" "${DESCRIZIONE}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${CLASSE}\DefaultIcon" "" "${ICONA}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${CLASSE}\shell" "" "open"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${CLASSE}\shell\open" "" "Apri con Leggio"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${CLASSE}\shell\open\command" "" '"$appExe" "%1"'
!macroend

; Leggio in «Apri con» e, se l'estensione non ha ancora un programma, come predefinito.
!macro LeggioEstensione EXT CLASSE
  WriteRegNone SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${CLASSE}"
  ; HKCR è la vista unita di utente (HKCU) e computer (HKLM): con l'installazione «solo per me» un programma
  ; installato per tutti (Dike, Acrobat… in HKLM) non si vede in HKCU, e scrivere lì lo scavalcherebbe
  ReadRegStr $0 HKCR ".${EXT}" ""
  StrCmp $0 "" 0 +2
    WriteRegStr SHELL_CONTEXT "Software\Classes\.${EXT}" "" "${CLASSE}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".${EXT}" ""
!macroend

!macro LeggioTogliEstensione EXT CLASSE
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${CLASSE}"
  ReadRegStr $0 SHELL_CONTEXT "Software\Classes\.${EXT}" ""
  StrCmp $0 "${CLASSE}" 0 +2
    DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}" ""
!macroend

!macro customInstall
  ; PDF
  !insertmacro LeggioClasse "Leggio.PDF" "Documento PDF" "$appExe,0"
  !insertmacro LeggioEstensione "pdf" "Leggio.PDF"
  ; documenti firmati digitalmente (CAdES): tipo e icona propri, mai «PDF»
  !insertmacro LeggioClasse "Leggio.FirmatoP7M" "Documento firmato digitalmente (CAdES)" "$INSTDIR\resources\p7m.ico"
  !insertmacro LeggioEstensione "p7m" "Leggio.FirmatoP7M"
  !insertmacro LeggioEstensione "m7m" "Leggio.FirmatoP7M"
  !insertmacro LeggioEstensione "tsd" "Leggio.FirmatoP7M"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "Leggio"
  ; pulizia delle associazioni delle versioni precedenti (classi con nomi generici)
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.p7m\OpenWithProgids" "Documento firmato digitalmente"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.m7m\OpenWithProgids" "Documento firmato digitalmente"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.tsd\OpenWithProgids" "Documento firmato digitalmente"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.pdf\OpenWithProgids" "Documento PDF"
  ReadRegStr $0 SHELL_CONTEXT "Software\Classes\.p7m" ""
  StrCmp $0 "Documento firmato digitalmente" 0 +2
    WriteRegStr SHELL_CONTEXT "Software\Classes\.p7m" "" "Leggio.FirmatoP7M"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Documento firmato digitalmente"
  ReadRegStr $0 SHELL_CONTEXT "Software\Classes\.pdf" ""
  StrCmp $0 "Documento PDF" 0 +2
    WriteRegStr SHELL_CONTEXT "Software\Classes\.pdf" "" "Leggio.PDF"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Documento PDF"
  ; Esplora risorse rilegge icone e tipi
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  !insertmacro LeggioTogliEstensione "pdf" "Leggio.PDF"
  !insertmacro LeggioTogliEstensione "p7m" "Leggio.FirmatoP7M"
  !insertmacro LeggioTogliEstensione "m7m" "Leggio.FirmatoP7M"
  !insertmacro LeggioTogliEstensione "tsd" "Leggio.FirmatoP7M"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Leggio.PDF"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Leggio.FirmatoP7M"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
