# 小键盘设置截图

来源：旧版 WPF 项目
`E:/wpf/wpf/SnookerApp/Snooker_2D/Assets/Images/KeyBoardSettingImage/{win10,win7}/`

目录约定（**换图只要同名覆盖，不用改代码**）：

```
win10/1.png … 5.png     Win10 / Win11 的 5 步
win7/1.png  … 3.png     Windows 7 的 3 步
```

- 数字对应 `src/renderer/src/content/keyboard.ts` 里每一步的 `index`
- 某张图缺失时，页面上那一步会显示「这张截图待补」，**不会整步消失**（步骤数是固定的）
- 支持 `.png` / `.jpg` / `.webp`
