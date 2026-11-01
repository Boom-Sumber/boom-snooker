/**
 * 小键盘设置步骤（T3.7）
 *
 * 文案与截图都来自旧版 WPF 项目：
 *   `E:\wpf\wpf\SnookerApp\Snooker_2D\Views\KeyBoardView.xaml`
 *   `E:\wpf\wpf\SnookerApp\Snooker_2D\Assets\Images\KeyBoardSettingImage\{win10,win7}\N.png`
 *
 * 步骤是**固定的**（不是从目录扫出来的）：旧版就是这么写死的，
 * 少一张图应该显示"这张截图待补"，而不是整步消失 —— 那样用户会以为步骤变少了。
 * 图片按 `assets/keyboard/<system>/<index>.png` 约定加载。
 */

export type KeyboardSystem = 'win10' | 'win7'

export interface KeyboardStep {
  /** 1-based，同时是图片文件名 */
  index: number
  title: string
}

export interface KeyboardSystemGroup {
  key: KeyboardSystem
  label: string
  /** 一句话说明这套步骤针对什么系统 */
  hint: string
  steps: KeyboardStep[]
}

export const KEYBOARD_GROUPS: KeyboardSystemGroup[] = [
  {
    key: 'win10',
    label: 'Win10 / Win11',
    hint: 'Win10 与 Win11 的「轻松使用」路径基本一致。',
    steps: [
      { index: 1, title: '打开 控制面板 → 轻松使用设置中心 → 使鼠标更易于使用' },
      { index: 2, title: '鼠标设置' },
      { index: 3, title: '开启并设置鼠标键' },
      { index: 4, title: '打开 控制面板 → 轻松使用设置中心 → 使键盘更易于使用 → 设置筛选键' },
      { index: 5, title: '设置重复键和慢速键' }
    ]
  },
  {
    key: 'win7',
    label: 'Windows 7',
    hint: 'Win7 的路径与 Win10 略有不同，按下面三步来。',
    steps: [
      { index: 1, title: '打开 控制面板 → 轻松使用设置中心 → 使键盘更易于使用' },
      { index: 2, title: '开启并设置鼠标键' },
      { index: 3, title: '鼠标设置' }
    ]
  }
]
