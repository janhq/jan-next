---
description: "侧栏与首页首屏的 Jan 品牌图形。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-official

[English](README.md) | 中文

## 概述

本包在 tokamak-harness 中提供 Jan 品牌：所有构建 profile 下，侧栏标志与会话首屏标志均显示 Jan 挥手标志；以 `official` profile 构建时，侧栏标志旁显示名称“Jan”。随产品提供的 Web 与 Desktop 组合默认加载本包。本包不增加模型请求。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

随产品提供的 Web 与 Desktop 组合已挂载本插件；无需安装或启用，也不接受配置。

### 选择 profile

`DSH_CLIENT_BUILD_PROFILE` 只控制侧栏名称。`official` 构建显示本包提供的“Jan”。其他取值保留侧栏的本地构建标签，即本地化的 `brand.localBuild` 文本（英文为“Jan”）后接构建版本，点击可复制版本号。两个标志在所有 profile 下都显示 Jan 标志。

### 替换品牌

拥有自身品牌的部署不加载本包，改为组合另一个占用 `sidebar.brand.mark`、`sidebar.brand.name` 与 `conversation.hero.brand.mark` 的包。占用插槽是唯一的组合途径；图形身份不可配置。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

每个填充都通过 `ctx.slots.inject()` 安装，它会等待对应的插槽声明，因此无论本行在声明者之前还是之后激活，注册都能工作；声明消失时注册随之撤回，HMR 期间也不会留下残缺的品牌。同一个组件 `OfficialBrandMark` 按各宿主请求的尺寸渲染装饰性标志图片，并保留首屏为几何布局传入的宿主类名。标志文件是 [`src/client/assets/jan-logo.png`](src/client/assets/jan-logo.png)，即 [janhq/jan](https://github.com/janhq/jan) 中 Jan 应用自身的标志；`apps/web/scripts/render-app-icons.ts` 用同一文件渲染 Web 网站图标与安装图标。浏览器部分是 [`src/client/index.ts`](src/client/index.ts)；Node 部分是空的 Loader 位置。浏览器标题属于构建环境（`DSH_CLIENT_TITLE`），不经过插槽系统。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当品牌表面不足以说明问题时阅读以下页面。它们从本包占用的插槽延伸到渲染这些插槽的外壳。

- [ui-sidebar](../ui-sidebar/README.zh.md) — 声明 `sidebar.brand.mark` 与 `sidebar.brand.name` 并渲染它们的回退。
- [ui-conversation](../ui-conversation/README.zh.md) — 在首屏声明 `conversation.hero.brand.mark`。
- [Web 客户端架构](../../../docs/subsystems/web-client.zh.md) — 浏览器插件行如何加载并注册插槽。

-----

<a id="model-experience"></a>
## 模型体验

无，本包只提供浏览器呈现；不会进入任何模型请求。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明品牌呈现的提供方式。它们是本包当前的约束，不是品牌设计比较，也不是任务清单。

- **只有一组填充** — 其他呈现方式应由占用相同插槽的另一个 Cordis 包提供。
- **侧栏标志不复制构建版本** — 在非 official 构建中，只有本地构建标签会复制版本号。
- **浏览器标题独立于本包** — `DSH_CLIENT_TITLE` 在构建时选择标题文本，而不是通过 UI 插槽。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景 — 点击展开</summary>

无。

</details>
