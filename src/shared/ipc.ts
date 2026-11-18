/** IPC 通道名常量，主进程与 preload 共用，避免字符串漂移。 */
export const IPC = {
  boardGet: 'board:get',
  noteCreate: 'note:create',
  noteUpdate: 'note:update',
  notesMove: 'notes:move',
  notesDelete: 'notes:delete',
  groupCreate: 'group:create',
  groupUpdate: 'group:update',
  groupDelete: 'group:delete',
  groupMove: 'group:move',
  cameraSet: 'camera:set',
  search: 'board:search',
  tagsList: 'tags:list',
  imageSave: 'image:save',
  clipboardImage: 'clipboard:image',
  settingsGet: 'settings:get',
  settingsPatch: 'settings:patch',
  shortcutProbe: 'shortcut:probe',
  shortcutSet: 'shortcut:set',
  backupNow: 'backup:now',
  backupState: 'backup:state',
  backupRestorePoints: 'backup:restore-points',
  backupRestore: 'backup:restore',
  windowAction: 'win:action',
  appInfo: 'app:info',
  openExternal: 'app:open-external',
  captureSubmit: 'capture:submit',
  captureClose: 'capture:close',
  captureLocate: 'capture:locate'
} as const

/** main → renderer 事件通道 */
export const EVENTS = {
  boardChanged: 'evt:board-changed',
  backupState: 'evt:backup-state',
  windowState: 'evt:window-state',
  locateNote: 'evt:locate-note',
  flyToRecent: 'evt:fly-to-recent',
  settingsChanged: 'evt:settings-changed',
  captureOpened: 'evt:capture-opened'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
export type EventChannel = (typeof EVENTS)[keyof typeof EVENTS]
