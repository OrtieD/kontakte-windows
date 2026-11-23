# Kontakte – Apple-Kontakte-Nachbau für Windows (Electron)

## Starten (Entwicklung)
    npm install
    npm start

## Windows-Build (auf einem Windows-PC)
    npm install
    npx electron-builder --win nsis portable
Ergebnis in `dist/`: Installer + portable .exe.
(Auf Mac/Linux ist für den Windows-Installer Wine nötig; ohne Wine: `npx electron-builder --win dir`.)

## Daten
`%APPDATA%\Kontakte\contacts.json`, tägliche Sicherungen in `backups\` (14 Tage).

## Tastenkürzel
Strg+N neu · Strg+E bearbeiten/fertig · Strg+F suchen · Strg+I importieren · Strg+A alle · Entf löschen · ↑/↓ · Esc

## iCloud-Synchronisierung (ab 1.1)
Sidebar unten „iCloud nicht verbunden“ anklicken → Apple-ID + app-spezifisches Passwort.
Abgleich per CardDAV (contacts.icloud.com) in beide Richtungen: beim Start, alle 5 Min., 4 s nach jeder Änderung.
Gruppen werden als Apple-Gruppenkarten übertragen; unbekannte Apple-Felder (Verwandte, Social-Profile …) bleiben erhalten.
Konflikte: neuere Änderung gewinnt. Favoriten bleiben lokal. Passwort per Windows-DPAPI (safeStorage) verschlüsselt in `%APPDATA%\Kontakte\icloud.json`.
