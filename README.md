# vectorize — 位图转矢量插件

> **独立仓库版**：下面的路径都相对仓库根目录。已经带了编译好的 `lib/`，
> 把仓库交给别人后运行 `install.ps1` 就能装进本机 dsh profile；改源码后
> `npx tsc -p tsconfig.build.json` 重新生成 `lib/` 即可。
把 PNG / JPEG / WebP 转成干净的矢量图（SVG 或 PDF 兼容的 `.ai`），并对线条做优化：节点精简、直线化、三次贝塞尔拟合。支持保留半透明与渐变。

作为 DeepSeek Harness 插件时，它注册一个模型可调用的工具 `vectorize_image`；同时自带命令行，方便批量处理。

## 快速开始

### 1. 作为插件加载

```sh
# 在仓库根目录
pnpm dsh web --patch ./cordis.yml
```

`cordis.yml` 里写的是本机绝对路径，换机器时改成自己的仓库路径。加载后直接对模型说：
“把 `E:/pics/logo.png` 转成矢量图，颜色少一点、线条平滑一点。”

### 2. 命令行（不需要启动会话）

```sh
node --import tsx src/cli.ts input.png --format both --colors 4 --precision 0.8

# 保留半透明 / 渐变
node --import tsx src/cli.ts shadow.png --alpha --colors 6 --format both
```

输出 `input.svg` 和 `input.ai`（同名覆盖原扩展名）。

## 工具参数

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `input` | string | 必填 | 源图路径（png / jpg / webp） |
| `output` | string | 源图同名 | 输出路径；扩展名决定格式 |
| `format` | `svg` \| `ai` \| `both` | `svg` | `ai` 输出 PDF 兼容的 Illustrator 文件 |
| `colors` | integer 2-64 | 6 | 调色板大小；纯色 logo 会保留原色 |
| `precision` | number 0.2-3 | 0.8 | 拟合容差（源图像素）；越大节点越少、线条越平滑 |
| `max_size` | integer 64-4096 | 1600 | 工作分辨率上限，大图先缩放 |
| `smooth` | integer 0-3 | 1 | 上色前的 3×3 多数投票次数，去 JPEG 噪点 |
| `alpha` | boolean | false | 保留半透明像素：每个连通域/透明度带单独带 `fill-opacity`（柔和阴影、渐变、半透明图层） |
| `width_mm` | number | 100 | SVG / AI 的物理宽度 |

返回的规范结果包含 `outputs`、`palette`、`shapes`、`subpaths`、`nodes`、`bytes`，可用来判断线条被压缩到什么程度。

## 线条是怎么优化的

1. **解码**：`sharp` 读图、按 EXIF 旋转、按最长边缩放。
2. **调色板**：5-bit RGB 直方图 + 中位切分，最多 `colors` 个色块；每一个像素按最近色着色，透明像素单独排除。
3. **平滑**：对色标做 3×3 多数投票，消掉抗锯齿和 JPEG 振铃产生的杂点。
4. **轮廓**：对每个色块跑 marching squares，得到沿像素边的闭合轮廓（半像素精度），保证相邻色块严丝合缝。
5. **简化与拟合**：RDP 化简 → 按曲率找角点 → 每段做三次贝塞尔最小二乘拟合（Schneider 算法 + 重参数化），并检查弓形误差，超差就自动拆分。近平直的长段直接落成直线。
6. **输出**：同色合并为一条复合路径，`even-odd` 填充让字腔自动成洞；色块按覆盖面积从大到小叠放；`.ai` 是 PDF 1.4 兼容文件，Illustrator 打开即为可编辑路径（每个页面一个画板）。

## 半透明与渐变（`alpha: true`）

默认模式把 alpha 当遮罩，低于阈值就丢弃；`alpha: true` 时按下面的规则保留透明信息：

1. **调色板只从“实心”像素学**（alpha ≥ 128），淡边缘不会污染颜色，也不会拆出毛边色块。
2. 每个色块先做连通域分解：一个字母、一颗网点、一块阴影各自成对象，字腔仍然是同一个路径里的挖空。
3. 每个连通域看 alpha 分布：
   - 大部分像素接近不透明（≥ 90%）→ 一个不透明图形，抗锯齿边自然吸收；
   - alpha 基本一致但小于 90% → 一个半透明图形，`fill-opacity` 等于该值；
   - alpha 在图形内部明显变化 → 按 15%–85% 分位切成 2–4 个透明度带，各自一个图形。
4. 输出：SVG 用 `fill-opacity`，`.ai`/PDF 用 `/ExtGState` 的 `ca`，Illustrator 里就是每个对象的「不透明度」。

实测：前脸（不透明）开 alpha 后仍是 22 个对象、1107 个节点，视觉与关闭时一致；盖子网点图（900px）得到 1384 个圆点对象，每个点保留自己的透明度，渐变完整保留。

> 网点/渐变这类图会得到较多对象，这是“保留渐变”的必然代价；不需要时可关掉 alpha。

## 已知限制

- **默认模式**（`alpha: false`）：alpha 只当遮罩用（阈值 128），柔和阴影、渐变会被截断；需要保留就开 `alpha: true`。
- **照片**：只会得到海报化色块，不适合还原写实照片。
- **`.ai` 格式**：输出的是 PDF 兼容的 AI 文件（Illustrator、Affinity、InDesign 都能打开），不是 Adobe 私有二进制的 AIPrivateData。
- 默认工作分辨率 1600px：超大图会被缩小，细节以 `max_size` 为准。

## 安装到当前 profile（本机已完成）

插件已装进 `C:\Users\Administrator\.dsh\profiles\node_modules\@deepseek-ai\dsh-plugin-vectorize`，并在 desktop / web 两个 profile 的 `cordis.patch.yml` 里登记（原文件备份为 `cordis.patch.yml.bak-20261105`）：

```yaml
- insert:
    - id: vectorize
      name: '@deepseek-ai/dsh-plugin-vectorize'
```

**重启桌面端后生效**（profile 的用户补丁层只在启动时读取）。启动后新会话里模型就能调用 `vectorize_image`。

卸载：恢复备份文件，再删除 `profiles/node_modules/@deepseek-ai/dsh-plugin-vectorize` 目录。

标准安装方式（包已声明 `dsh.bundle.patch`）：

```sh
dsh plugin --profile desktop add <包名或 file:路径>
```

## 开发

```sh
# 类型检查（走仓库内的源码声明）
node node_modules/typescript/bin/tsc -p tsconfig.typecheck.json --noEmit

# 编译成 lib/（cordis.yml 默认加载这个入口）
node node_modules/typescript/bin/tsc -p tsconfig.build.json

# 单元测试
npx vitest run
```

### 关于 `node_modules`

构建沙箱不允许创建符号链接，所以本目录的 `node_modules/@deepseek-ai/*`、`node_modules/sharp` 是**转发壳**（一个 `package.json` + 一个 re-export 文件），指向仓库里的真实包。正常环境请把插件纳入 pnpm workspace（在 `pnpm-workspace.yaml` 加 `plugins/*`）后执行 `pnpm install`，它会替换成正式链接，源码不用改。

目录结构：

```
./
  cordis.yml            # --patch 加载入口
  cordis.patch.yml      # bundle 层（dsh plugin add 用）
  src/index.ts          # 插件：注册 vectorize_image 工具
  src/cli.ts            # 命令行
  src/vectorize/        # 核心：quantize → contour → curve → svg / pdf
  tests/                # 几何、工具、alpha 三组测试
```

## 分享给别人

### 方式 A：打包 zip（最省事，不需要联网）

仓库里已经生成好 `dist/dsh-plugin-vectorize-0.2.0.zip`，解压后包含 `lib/`、`package.json`、`README.md`、`cordis.patch.yml`、`install.ps1`。

对方解压后执行：

```powershell
# 默认装进 desktop profile；也可 -Profile web 或 -DshHome D:\.dsh
.\install.ps1
```

脚本会：把包复制到 `<dsh home>\profiles\node_modules\@deepseek-ai\dsh-plugin-vectorize` → 备份并修改 `cordis.patch.yml` → 检查 `sharp` / `@deepseek-ai/dsh-tools` 是否在 profile 里 → 跑一次注册冒烟测试。之后重启 dsh 即可。

> 前提：对方装的是同一代 dsh 桌面版（profile 的 `node_modules` 里自带 `sharp@0.35.3` 和 `@deepseek-ai/dsh-tools@0.1.0-rc.5`）。版本差太远时 `dsh-tools` 的接口可能不兼容。

### 方式 B：发 npm 包（适合长期维护）

```sh
# 把 name 改成自己的 scope（@deepseek-ai 是官方占用），去掉 "private": true
npm publish
# 对方：
dsh plugin --profile desktop add @your-scope/dsh-plugin-vectorize
```

包已经声明了 `dsh.bundle.patch`，`dsh plugin add` 会自动把 bundle 的补丁层挂进 profile。

### 方式 C：发 git 仓库

把本仓库作为子目录放进对方项目，在 `pnpm-workspace.yaml` 里加入该目录，`pnpm install` 后按 `cordis.yml`（绝对路径）或 `cordis.patch.yml`（包名）加载。

### 分享时别带上这些

- `node_modules/`：里面的 `sharp`、`@deepseek-ai/*` 是**指向本机的转发壳**，别人机器上无效。
- `out/`、`tests/__pycache__`：本地产物。
- 需要的话可以带 `src/`（方便对方改），但运行只需要 `lib/`。

