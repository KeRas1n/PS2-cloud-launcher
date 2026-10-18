# electron-builder's default update uninstall recursively removes $INSTDIR,
# including legacy emulator folders and user-selected games/saves stored there.
# During updates, overlay application files instead; never delete user content.
!macro customRemoveFiles
  ${ifNot} ${isUpdated}
    SetOutPath $TEMP
    RMDir /r $INSTDIR
  ${endif}
!macroend
