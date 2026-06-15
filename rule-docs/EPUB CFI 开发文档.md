# EPUB CFI 开发文档

> 基于 **W3C EPUB Canonical Fragment Identifiers 1.1**（2026-06-11 Editor's Draft）
> 前身为 IDPF EPUB CFI 1.0（2011-09-08），现已移交 W3C 维护
> 适用于 EPUB 3 及以上版本的精确内容定位开发

---

## 📋 目录

1. [概述](#1-概述)
2. [CFI 核心语法](#2-cfi-核心语法)
3. [节点索引规则](#3-节点索引规则)
4. [虚拟元素（CFI 1.1 新增）](#4-虚拟元素cfi-11-新增)
5. [跨文件定位机制](#5-跨文件定位机制重点)
6. [终止步骤详解](#6-终止步骤详解)
7. [断言与鲁棒性](#7-断言与鲁棒性)
8. [范围（Range）定位](#8-范围range定位)
9. [排序与比较](#9-排序与比较)
10. [转义处理](#10-转义处理)
11. [校正（Correction）机制](#11-校正correction机制)
12. [扩展性](#12-扩展性)
13. [实战示例全集](#13-实战示例全集)
14. [实现建议与注意事项](#14-实现建议与注意事项)
15. [CFI 1.0 → 1.1 变化汇总](#15-cfi-10--11-变化汇总)

---

## 1. 概述

EPUB CFI（Canonical Fragment Identifier）是 EPUB 出版物内 **唯一标识任意位置或范围** 的标准方法。它是 IRI 片段标识符的一部分，以 `#epubcfi(...)` 的形式附加在 EPUB 资源 URL 之后。

```html
book.epub#epubcfi(/6/4[chap01ref]!/4[body01]/10[para05]/3:10)
                              ↑
                     CFI 跟在 # 号之后
```

### 1.1 设计目标

| 目标 | 说明 |
|------|------|
| **互操作性** | 阅读系统 A 创建的引用，系统 B 能解析到同一位置 |
| **无侵入** | 无需在目标文档中嵌入锚点或标记 |
| **规范性** | 同一逻辑位置的 CFI 引用应完全相等 |
| **高效比较** | 不打开引用文档即可完成排序和比较 |
| **高效解析** | 引用最后一章不必先处理第一章 |
| **鲁棒性** | 文档修订后仍能尝试恢复目标位置 |
| **范围支持** | 支持连续的简单范围 |
| **可扩展** | 支持厂商自定义校正算法 |

### 1.2 CFI 的两种类型

| 类型 | URL 形式 | 起始节点 |
|------|---------|---------|
| **Standard EPUB CFI**（出版级） | `book.epub#epubcfi(...)` | `<package>` 下的 `<spine>` 子元素 |
| **Intra-Publication CFI**（内部） | `package.opf#epubcfi(...)` | `<package>` 根元素 |

### 1.3 应用场景

- 📌 **阅读进度同步**：设备 A → 服务端 → 设备 B
- 🖍️ **批注/书签**：高亮特定段落、文字
- 🔗 **交叉引用**：目录指向正文、注释双向跳转
- 📊 **统计追踪**：记录用户在文中的精确位置

---

## 2. CFI 核心语法

### 2.1 基本结构

```
epubcfi(/6/4[chap01ref]!/4[body01]/10[para05]/3:10)

  │        ├─── 导航步骤 ──┤│├─── 在新文档中导航 ─────┤││
  │                         │                          │└── 终止步骤
  │                         │                          │    （字符偏移）
  │                         │                          │
  │                         │                          │
  │                         └── 间接步骤（跨文件跳转）───┘
  │
  └── epubcfi() 声明 CFI
```

### 2.2 完整 EBNF（CFI 1.1）

```ebnf
(* 所有终结符号位于 Unicode Basic Latin 区 U+0000-U+007F *)

fragment          = "epubcfi(" , ( path , [ range ] ) , ")" ;
path              = step , local_path ;
range             = "," , local_path , "," , local_path ;
local_path        = { step } , ( redirected_path | [ offset ] ) ;
redirected_path   = "!" , ( offset | path ) ;
step              = "/" , integer , [ "[" , assertion , "]" ] ;
offset            = ( ( ":" , integer )
                    | ( "@" , number , ":" , number )
                    | ( "~" , number , [ "@" , number , ":" , number ] )
                    ) , [ "[" , assertion , "]" ] ;
assertion         = ( ( value , [ "," , value ] )
                    | ( "," , value )
                    | ( parameter )
                    ) , { parameter } ;
parameter         = ";" , value-no-space , "=" , csv ;
csv               = value , { "," , value } ;
number            = ( digit-non-zero , { digit } , [ "." , { digit } , digit-non-zero ] )
                  | ( zero , [ "." , { digit } , digit-non-zero ] ) ;
integer           = zero | ( digit-non-zero , { digit } ) ;
value             = string-escaped-special-chars ;
value-no-space    = value - ( [ value ] , space , [ value ] ) ;
```

### 2.3 生产规则说明

| 产生式 | 含义 |
|--------|------|
| `fragment` | CFI 整体外壳：`epubcfi(路径[,范围])` |
| `path` | 一个步骤后跟局部路径 |
| `range` | 逗号 + 起始子路径 + 逗号 + 结束子路径 |
| `local_path` | 零或多个步骤后，要么重定向（`!`），要么以偏移结尾 |
| `redirected_path` | `!` 后跟偏移或完整路径（**CFI 1.1 新提取的独立产生式**） |
| `step` | `/索引[断言]` |
| `offset` | 字符/空间/时间偏移 + 可选断言 |
| `assertion` | ID/文本断言或参数序列 |
| `parameter` | `;名=值` 格式的扩展参数 |

---

## 3. 节点索引规则

### 3.1 奇偶规则

这是 **最容易出错的地方**，必须死记：

| 索引 | 节点类型 | 说明 |
|------|---------|------|
| **奇数**（1, 3, 5...） | **文本节点集合**（TNC） | 相邻文本节点的聚合（含空白） |
| **偶数**（2, 4, 6...） | **元素节点** | 按文档顺序排列的元素 |
| **0** | **虚拟前导元素**（CFI 1.1） | 第一个文本集合之前的虚拟位置 |
| **n+2** (n为最后偶数) | **虚拟后置元素**（CFI 1.1） | 最后一个文本集合之后的虚拟位置 |

### 3.2 计数方式

```
<doc>                        ← 父节点
  Hello           ─→ 第 1 个子节点（奇数 → 文本节点集合，内容: "Hello ")
  <p>             ─→ 第 2 个子节点（偶数 → 元素节点）
    World         ─→ 第 1 个子节点（奇数 → 文本节点集合，内容: "World"）
  </p>
  !               ─→ 第 3 个子节点（奇数 → 文本节点集合，内容: "! ")
  <img>           ─→ 第 4 个子节点（偶数 → 元素节点）
  <p>             ─→ 第 6 个子节点（偶数 → 元素节点）
    Foo Bar       ─→ 第 1 个子节点（奇数 → 文本节点集合，内容: "Foo Bar"）
    <em>          ─→ 第 2 个子节点（偶数 → 元素节点）
      test        ─→ 第 1 个子节点（奇数 → 文本节点集合，内容: "test"）
    </em>
    baz           ─→ 第 3 个子节点（奇数 → 文本节点集合，内容: "baz"）
  </p>
</doc>
```

### 3.3 关键说明

1. **索引从 1 开始**，连续自然数（1, 2, 3, 4...），奇偶决定类型
2. **文本节点集合（TNC）** = 两个元素之间 **所有** 相邻文本节点的拼接
   - `<p>hello<b>world</b>!</p>` → `hello`（TNC1）、`world`（TNC2）、`!`（TNC3）
   - 注意 `<b>` 打断了文本连续性，所以 `hello` 和 `!` 不在同一个集合中
3. **XML 非元素内容被忽略**（注释、处理指令等不计入索引）
4. **CDATA 内容被包含**，实体引用视为已扩展
5. **空白被保留**——元素间的缩进空白也算作文本节点
6. **CFI 表达式终止于奇数步骤 SHOULD 包含显式偏移**，但处理器 **MUST 接受隐式的 `/N:0`**

### 3.4 编程实现

```python
def compute_cfi_index(parent, target_child):
    """
    计算 target_child 在 parent 的子节点列表中的 CFI 索引。
    所有子节点混排计数（1-based），奇偶决定类型。
    target_child 可以是 Element、TextNode 或文本字符串。
    """
    from xml.etree import ElementTree
    
    idx = 1
    for child in parent:  # 文档顺序遍历
        if child is target_child:
            return idx
        idx += 1
    raise ValueError("target_child not found in parent")
```

> ⚠️ **实现关键**：XML 解析器对空白节点的处理会影响索引。建议统一使用 **preserve whitespace** 的解析模式，并对 CDATA / 实体扩展做一致化处理。

---

## 4. 虚拟元素（CFI 1.1 新增 ⭐）

CFI 1.1 新增了 **虚拟元素（Virtual Elements）** 机制，这是与 CFI 1.0 最重要的区别之一。

### 4.1 概念

在任意父元素的内容模型中，除了真实的子元素之外，还存在两个**虚拟元素**：

```
虚拟前导         真实元素序列              虚拟后置
    │       ┌──────┼──────┐                  │
    ▼       ▼      ▼      ▼                  ▼
  [0]  [TNC1] [Elm2] [TNC3] [Elm4] ... [TNC(n+1)] [n+2]
```

| 索引 | 含义 |
|------|------|
| **`0`** | 在父元素第一个子内容**之前**的虚拟元素 |
| **`n+2`** | 在父元素最后一个子内容**之后**的虚拟元素（`n` = 最后一个真实元素的偶数索引） |

### 4.2 用途

主要用于 **DOM Range 互操作性**——某些 DOM Range 跨过文本内容边界时需要引用不存在的元素位置，虚拟元素提供了这种能力。

### 4.3 消费者（读取方）要求

- **MUST** 能解析包含 `0` 和 `n+2` 引用的 CFI 表达式
- 即使第一个或最后一个文本集合为空，也要能处理

### 4.4 生产者（生成方）约束

| 场景 | 要求 |
|------|------|
| 第一个文本集合**为空** | **SHOULD NOT** 使用虚拟元素 `0`，而应指向第一个真实元素 `/2` |
| 最后一个文本集合**为空** | **SHOULD NOT** 使用虚拟元素 `n+2`，而应指向最后一个真实元素 |

### 4.5 示例

```xml
<div>
  <p>First</p>        <!-- /2 -->
  <p>Second</p>       <!-- /4 -->
</div>
```

- `<div>` 下**没有第一个文本集合**（`<p>` 前无空白）
- 虚拟前导：`/0`
- 最后一个真实元素索引：`/4`（n=4）
- 虚拟后置：`/6`（n+2=6）
- 如果想表达 "`<div>` 开始处" 但不使用字符偏移，可以用 `/0`

---

## 5. 跨文件定位机制（重点 ⭐）

这是 EPUB CFI 最复杂的部分——EPUB 出版物由多个独立 XHTML/XML 文档组成，CFI 需要跨越文档边界精确定位。

### 5.1 出版物结构

```
META-INF/
  container.xml          ← 指向默认 Rendition 的 package 文档
OEBPS/
  package.opf            ← 包文档（manifest + spine）
  chapter01.xhtml        ← 内容文档
  chapter02.xhtml
  style.css
  image.png
```

**package.opf** 简化示例：

```xml
<?xml version="1.0"?>
<package ...>
  <metadata>...</metadata>
  <manifest>
    <item id="chapter01" href="chapter01.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter02" href="chapter02.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref id="chap01ref" idref="chapter01" linear="yes"/>
    <itemref id="chap02ref" idref="chapter02" linear="yes"/>
  </spine>
</package>
```

### 5.2 跨文件定位流程

```
epubcfi(/6/4[chap01ref]!/4[body01]/10[para05]/2/1:3)

              包文档导航             !        目标文档导航
          ┌────────────┐           ───      ┌──────────────┐
          │ /6 → spine │  ────▶   跳转   ──▶│ /4 → body01  │
          │ /4 → itemref│        跨文件      │ /10 → para05│
          └────────────┘        边界        │ /2 → em     │
                                           │ /1:3 → 偏移 3│
                                           └──────────────┘
```

#### 第 1 步：`/6` — 定位到 `<spine>`

在 `<package>` 根元素下按文档顺序数子元素：

| 索引 | 元素 |
|------|------|
| `/2` | `<metadata>` |
| `/4` | `<manifest>` |
| **`/6`** | **`<spine>`** ← 命中 |

#### 第 2 步：`/4[chap01ref]` — 定位到 `<itemref>`

在 `<spine>` 下：

| 索引 | 元素 |
|------|------|
| `/2` | `<itemref id="chap01ref" idref="chapter01" />` |
| **`/4`** | **`<itemref id="chap02ref" idref="chapter02" />`** |

> **关于索引的说明**：根据规范原文示例，`/6` 是 `<spine>`（`<package>` 的第 3 个元素），`/4[chap01ref]` 是 `<spine>` 的第 2 个 `<itemref>`。这意味着规范的示例假设了 `<spine>` 只有 `<itemref>` 子元素且第一个 `<itemref>` 的索引为 `/2`，第二个为 `/4`。而 `chap01ref` 是第一个 `<itemref>`，索引为 `/2`。**实际实现时以目标文档的真实 DOM 节点顺序为准，规范示例只是示意。**

#### 第 3 步：`!` — 间接跳转

```
! 间接步骤解析算法：

1. 当前节点：<itemref id="chap01ref" idref="chapter01" />
   
2. ! 触发查找序列：
   a) 如果是 <itemref>，取 idref → "chapter01"
   b) 在 <manifest> 中找 id="chapter01" 的 <item>
      → <item id="chapter01" href="chapter01.xhtml" />
   c) 取出 href → "chapter01.xhtml"
   d) 加载该文档，后续步骤从此文档根节点开始

3. ! 可以后跟偏移（! + offset）或完整路径（! + path）
   例如：!/4[body01] 等效于在新文档根下以 /4[body01] 开始
```

#### 第 4 步：`/4[body01]/10[para05]/2/1:3` — 在目标文档中定位

```xml
<html>
  <head>...</head>             <!-- /2 -->
  <body id="body01">           <!-- /4 ← 命中 -->
    <p id="para05">            <!-- /10 ← 第 5 个元素 -->
      <em>xxxyyy0123456789</em>
      <!-- /2: <em> 元素, /1:3 → "yyy" 之后的位置 -->
    </p>
  </body>
</html>
```

### 5.3 `!` 寻址规则

`!` 按照以下规则查找引用目标：

| 属性 | 来源元素 | 说明 |
|------|---------|------|
| `idref` → manifest `href` | `<itemref>`（spine） | **EPUB 特有**：spine → manifest → href |
| `src` | `<iframe>`, `<embed>` | HTML 嵌入内容 |
| `data` | `<object>` | 外部对象 |
| `src` | `<img>`, `<audio>`, `<video>`, `<script>`, `<source>` | 嵌入媒体 |
| `xlink:href` | SVG `<image>`, `<use>` | SVG 引用 |

> ⚠️ **`!` 不跟随** `<a>` 超链接（HTML `<a>` / SVG `<a>`）。
>
> ✅ **`!` 可以出现在路径中间**，实现多层间接跳转（A → B → C）。

### 5.4 多层间接跳转

```
epubcfi(/6/4[ref1]!/2/6[ref2]!/4[body]/...)

package.opf ──▶ docA.xhtml ──▶ iframe ──▶ docB.xhtml
                                                  │
                                            /4[body]/...
```

### 5.5 内部出版物 CFI（Intra-Publication）

同一 EPUB 容器内文档间引用，与标准格式一致：

```
# 出版级（从 package 开始，含间接跳转）
epubcfi(/6/4[chap01ref]!/4[body01]/10[para05]/2/1:0)

# 内部（直连 package.opf，不含间接跳转）
package.opf#epubcfi(/4[body01]/10[para05]/2/1:0)
```

---

## 6. 终止步骤详解

终止步骤是 CFI 路径的 **最后一步**，精确到字符/像素/毫秒级别。

### 6.1 字符偏移 `:N`

```
/n:char_offset
```

| 属性 | 值 |
|------|-----|
| 应用范围 | 文本节点（奇数索引）或 `<img>` 的 `alt` 文本（偶数索引） |
| 偏移计算 | **UTF-16 代码单元**（不是字节，也不是 Unicode 代码点！） |
| 偏移起点 | **0**（0 = 第一个字符之前） |
| 隐式默认值 | 处理器 **MUST 接受** 终止于奇数索引的步骤无显式偏移（视作 `:0`） |

```
文本: "Hello World"
       01234567890

:0  → |Hello World  (最前面)
:5  → Hello| World
:11 → Hello World| (最后面)
```

> ⚠️ **UTF-16 特殊处理**：Emoji 🎉 等辅助平面字符占 **2** 个 UTF-16 代码单元。

### 6.2 时间偏移 `~N`

用于音视频内容，单位：秒（浮点数）。

```
~23.5       → 第 23.5 秒
~0          → 起点
~120.75     → 第 2 分 0.75 秒
```

### 6.3 空间偏移 `@X:Y`

用于图像/视频帧中的 2D 坐标。**缩放比例 0–100**，与原始分辨率无关：

```
@0:0        → 左上角
@100:100    → 右下角
@50:50      → 正中心
@25:75      → 距左 25%，距顶 75%
```

> ✅ CFI 1.1 明确：0–100 是**规范化的百分比**，不是像素坐标。

### 6.4 复合终止步骤 `~N@X:Y`

```
~23.5@5.75:97.6
  │     │   └── 垂直位置 97.6%
  │     └────── 水平位置 5.75%
  └─────────── 第 23.5 秒
```

- **时间必须在空间之前**，不能交换顺序
- 空间部分可选：`~N` 和 `~N@X:Y` 都合法

---

## 7. 断言与鲁棒性

断言是方括号 `[...]` 内的附加信息，用于 CFI 的验证和校正。

### 7.1 ID 断言

```
/4[chap01ref]
```

- 阅读系统解析时会检查目标元素的 `id` 是否匹配
- 如果不匹配，触发 **校正算法**（见第 11 章）
- 排序/比较时 **忽略 ID**

### 7.2 文本位置断言

只能跟在字符偏移终止步骤之后：

```
# 仅有前导文本
/1:3[yyy]      → 偏移位置前紧邻 "yyy"

# 前导文本 + 后随文本
/1:3[xx,yy]    → 前有 "xx"，后有 "yy"

# 仅有后随文本（前导为空）
/1:3[,yy]      → 偏移位置后紧邻 "yy"
/1:3[:yy]      → 同上（旧语法兼容）
```

规则：
- 空格被压缩为单个空格
- 匹配时忽略元素边界（跨标签文本也匹配）
- 主要用于矫正——文档更新后通过文本重新定位

### 7.3 边界偏好（Side Bias）

```
[;s=b]   → 属于之前的内容（before）
[;s=a]   → 属于之后的内容（after）
```

- 用于分页符位置，决定归属前页还是后页
- 必须放在最后一步方括号内
- **CFI 1.1 明确：边界偏好在空间偏移（`@`）和范围中未定义**

```
/4[body01]/10[para05]/2/1:0[;s=b]
```

---

## 8. 范围（Range）定位

### 8.1 语法

```
epubcfi(P,S,E)
  父路径 , 起始子路径 , 结束子路径
```

由三元组构成：

- **P（父路径）**：公共路径，不能为空
- **S（起始子路径）**：从父路径到起始点的剩余部分
- **E（结束子路径）**：从父路径到结束点的剩余部分

> P 应该是 S 和 E 最深的公共路径。S 可以为空（避免重复公共路径）。

### 8.2 示例

```
epubcfi(/6/4[chap01ref]!/4[body01]/10[para05],/2/1:1,/3:4)

父路径 = /6/4[chap01ref]!/4[body01]/10[para05]
起始   = /2/1:1  → <em> 内文本偏移 1
结束   = /3:4    → <p> 内第 2 个文本集合偏移 4
```

表示：从 `para05` 第一个元素（`<em>`）的第 1 个字符到 `para05` 第二个文本集合的第 4 个字符之间的范围。

### 8.3 比较规则

范围按以下优先级比较：

1. **PS（起始路径）**——起始越前，范围越前
2. **PE（结束路径）**——PS 相同时，结束越后，范围越大

> 注意：边界偏好在范围中 **未定义**（CFI 1.1 明确）。

---

## 9. 排序与比较

### 9.1 路径比较

```
比较优先级：
1. 第一个不同步骤的节点索引（数值比较）
2. 节点索引相同时，比较断言（字符串比较）
3. 导航步骤全部相同，比较终止步骤
```

> **断言不是排序主键**——`/4[chap01ref]` 与 `/4[other]` 排序时视为同一步骤。
> 断言仅在节点索引相同时作为次要依据。

### 9.2 跨文档比较

不同 spine item 的 CFI **不能直接字符串比较**。需先解析到同一文档：

```python
# ❌ 错误：字符串比较跨文档 CFI
"/6/4!" < "/6/6!"    # 无意义

# ✅ 正确：先解析到文档，再按 spine 顺序 + 文档内路径比较
resolve("/6/4!") → (chapter01.xhtml, "/4[body01]/10[para05]")
resolve("/6/6!") → (chapter02.xhtml, "/4[body01]/2[title]")
```

---

## 10. 转义处理

### 10.1 三层转义层次

```
                 原始文本
                     │
                     ▼    (先 反序解除)
            CFI 层转义（用 ^）
            ───────────────
                     │
                     ▼
            IRI 层转义（用 %）
            ───────────────
                     │
                     ▼
            XML 层转义（用 &xx;）
            ───────────────
                     │
                     ▼    (后 正序应用)
                最终输出
```

**编码顺序**：XML → IRI → CFI（从内到外）
**解码顺序**：CFI → IRI → XML（从外到内）

### 10.2 CFI 层转义字符

| 转义序列 | 代表字符 |
|---------|---------|
| `^^` | `^` |
| `^[` | `[` |
| `^]` | `]` |
| `^,` | `,` |
| `^(` | `(` |
| `^)` | `)` |
| `^;` | `;` |
| `^=` | `=` |

示例：
```
原始文本: "This is [test] v2.0 (beta)"
CFI 转义: "This is ^[test^] v2.0 ^(beta^)"
```

### 10.3 完整示例

```
原始文本:  Ф-"spa ce"-99%-aa[bb]^^

CFI 转义:  先转义特殊字符... ^^, ^[, ^]
           结果: Ф-"spa ce"-99%-aa^[bb^]^^
           
IRI 转义:  Ф → %D0%A4, 空格 → %20, % → %25
           结果: %D0%A4-%22spa%20ce%22-99%25-aa%5E%5Bbb%5E%5D%5E%5E

XML 转义:  " → &quot;
           结果: %D0%A4-&quot;spa%20ce&quot;-99%25-aa%5E%5Bbb%5E%5D%5E%5E
```

---

## 11. 校正（Correction）机制

当 EPUB 文档被更新（修订）后，CFI 可能因 DOM 结构变化而偏移。通过 **断言** 进行校正。

### 11.1 ID 校正

```
步骤: /10[para05]
  ↓
检查: 索引 /10 的元素的 id → "para04"（不匹配！）
  ↓
搜索文档中 id="para05" 的元素
  ↓
找到: 索引 /12（因为 para05 前被插入了一个元素）
  ↓
校正: /10[para05] → /12[para05]
```

### 11.2 文本校正

```
步骤: /1:5[World]
  ↓
检查: 偏移 5 处文本 → "Hello Java"（不匹配！）
  ↓
在当前文本集合中搜索 "World"
  ↓
找到: 偏移 8（文本从 "Hello World" 改为 "Hello Java World"）
  ↓
校正: /1:5[World] → /1:8[,World]
```

### 11.3 校正失败

如果 ID 或文本在文档中完全不存在，CFI **被视为无效引用**。

如果阅读系统无法在解析时检查 ID/文本（如没有文档 DOM 访问权限），则 **忽略断言**。

### 11.4 陈旧 CFI 替换

校正后的 CFI 应优先使用。阅读系统和内容管理系统 **SHOULD** 尽可能用校正后的版本替换陈旧的 CFI。

---

## 12. 扩展性

### 12.1 厂商参数

以 `vnd.` 开头的参数名称，使用分号引入：

```
/1:3[;vnd.acme.correction=aggressive]
```

### 12.2 参数语法

```
parameter = ";" , value-no-space , "=" , csv ;
csv       = value , { "," , value } ;
```

- 阅读系统必须忽略无法识别的参数
- 参数名推荐使用倒置域名（如 `vnd.com.example.correction`）

---

## 13. 实战示例全集

### 示例 1：书籍第一页

```
epubcfi(/6/2[cover]!//2/1:0)
```

| 步骤 | 含义 |
|------|------|
| `/6` | `<spine>` |
| `/2[cover]` | 第一个 `<itemref>`（封面） |
| `!` | 跳转到封面文档 |
| `/2` | 第一个元素 |
| `/1:0` | 第一个文本节点，偏移 0 |

### 示例 2：高亮一段文字

```
epubcfi(/6/4[chap01ref]!/4[body01]/10[para05],/2/1:1,/3:4)
```

从 `<em>` 内文本偏移 1 到 `para05` 的第二段文本偏移 4。

### 示例 3：图片中心（空间定位）

```
epubcfi(/6/2[cover]!/4[body01]/2[cover-img]@50:50)
```

指向 `<img id="cover-img">` 的正中心（50%, 50%）。

### 示例 4：视频特定时刻

```
epubcfi(/6/6[video-ref]!/2/4[video]/6/1:~120.5)
```

第 3 个 spine item 文档中，第 2 个 `<video>` 元素的第 120.5 秒。

### 示例 5：多层间接跳转（iframe）

```
epubcfi(/6/4[chap01ref]!/4[body01]/6[iframe-widget]!/2[body]/4[content]/1:0)
```

package → chapter01.xhtml → iframe → iframe 内部文档 → body → content → 第一个字符。

### 示例 6：分页边界偏好

```
epubcfi(/6/20[chapter-end]!/4[body01]/30[last-para]/1:0[;s=b])
```

位置（文本开始前）属于之前的内容块，用于分页归属。

### 示例 7：虚拟元素定位（CFI 1.1）

```xml
<div>
  <p>Content</p>
</div>
```

```
# 虚拟前导 — 指向 <div> 第一个内容之前
epubcfi(/6/4!/2/2/0)

# 等效于
epubcfi(/6/4!/2/2/1:0)  ← 第一个文本集合偏移 0
```

---

## 14. 实现建议与注意事项

### 14.1 解析器架构

```
┌─────────────────┐
│  CFI Parser     │  ← 词法解析 + 语法解析（EBNF）
└────────┬────────┘
         ▼ Token 序列（路径步骤列表）
┌─────────────────┐
│  Resolver       │  ← 在 EPUB 文档树（包文档 + 内容文档）上行走
└────────┬────────┘
         ▼ 解析结果（文档 + DOM 节点 + 偏移）
┌─────────────────┐
│  Locator        │  ← 返回精确位置信息
└─────────────────┘
```

### 14.2 关键注意事项

| 注意点 | 说明 |
|--------|------|
| **空白处理** | XML 解析器须一致化处理元素间空白（建议 preserve） |
| **UTF-16 偏移** | 辅助平面字符（Emoji 等）占 2 个 UTF-16 代码单元 |
| **CDATA 内容** | 计入文本节点集合 |
| **虚拟元素** | 必须能解析 `/0` 和 `/n+2`（CFI 1.1） |
| **隐式偏移** | 必须接受奇数步骤无显式偏移（视为 `:0`） |
| **跨文档比较** | 不同文档的 CFI 不能字符串比较，需先解析 |
| **`!` 后路径** | `!` 后跟 `/` 表示从新文档根节点开始 |
| **按需加载** | 解析器可延迟加载文档，不必一次加载全部 |
| **降级处理** | CFI 解析失败时优雅回退（如回到文档开头） |

### 14.3 参考实现

- **[epub.js](https://github.com/futurepress/epub.js/)**：JavaScript EPUB 渲染引擎，含 CFI 解析
- **[readium-js](https://github.com/readium/readium-js)**：Readium 项目 JS 实现
- **[python-epubcfi](https://pypi.org/project/epubcfi)**：Python CFI 解析库
- **[W3C EPUB 3.3 Test Suite](https://w3c.github.io/epub-tests/)**：官方测试套件

### 14.4 测试用例

```
# 正常路径
epubcfi(/6/4!/2/2/1:0)                    → 文档开头
epubcfi(/6/4!/2/2/1:5)                    → 偏移 5

# 带 ID 断言
epubcfi(/6/4[chap01ref]!/4[body01]/10[para05]/2/1:3[yyy])

# 范围
epubcfi(/6/4!/2/2/1:0,/1:10)              → 前 10 个字符

# 边界偏好
epubcfi(/6/4!/2/2/1:0[;s=b])              → 文档开头，属之前

# 虚拟元素（CFI 1.1）
epubcfi(/6/4!/2/2/0)                      → 虚拟前导

# 空间/时间
epubcfi(/6/4!/4[body01]/2[img]@50:50)     → 图片中心
epubcfi(/6/4!/4[body01]/6[video]/1:~10.5@25:75)
                                            → 视频 10.5 秒，左下

# 多层间接
epubcfi(/6/4!/4[body01]/6[iframe]/!/2/1:0)
                                            → iframe 内首个文本
```

---

## 15. CFI 1.0 → 1.1 变化汇总

### 15.1 新增内容

| 变化 | 说明 |
|------|------|
| **虚拟元素（Virtual Elements）** | 索引 `0` 和 `n+2`，用于 DOM Range 互操作性 |
| **隐式偏移要求** | 奇数步骤无显式偏移时处理器 MUST 接受（视为 `:0`） |
| **空间偏移规范化** | 明确 `@X:Y` 的范围是 0–100 的**缩放百分比** |
| **边界偏好限制** | 明确空间偏移和范围中**未定义** side bias |

### 15.2 EBNF 重构

| 旧（CFI 1.0） | 新（CFI 1.1） | 变化 |
|---------------|---------------|------|
| `path = step , { step } , [ termstep ]` | `path = step , local_path` | 重构出 `local_path` |
| `indirection = "!"` | `redirected_path = "!" , ( offset \| path )` | 独立产生式，结构更清晰 |
| `terminus = ...` | `offset = ...` | 改名为 offset，统一语法 |
| `number = integer , [ "." , { digit } ]` | `number = ... digit-non-zero` | 小数部分末尾不能为零 |
| `assertion = ...` | `assertion = ( value [,value] \| ",value" \| parameter ) {parameter}` | 支持参数作为独立断言 |

### 15.3 维护组织变更

| 项目 | 旧（CFI 1.0） | 新（CFI 1.1） |
|------|---------------|---------------|
| 维护组织 | IDPF | **W3C**（Publishing Maintenance Working Group） |
| 规范主页 | `idpf.org/epub/linking/cfi` | `w3c.github.io/epub-specs/epub33/epubcfi` |
| 最新发布版 | — | `w3.org/TR/epubcfi` |

### 15.4 不变的核心

- 节点索引奇偶规则（偶数=元素，奇数=文本）**不变**
- 间接步骤 `!` 的寻址机制 **不变**
- 三层转义顺序（XML → IRI → CFI）**不变**
- 断言/校正机制 **不变**
- 范围语法和比较规则 **不变**

---

## 附录：术语对照表

| 英文 | 中文 | 说明 |
|------|------|------|
| CFI | 标准片段标识符 | Canonical Fragment Identifier |
| Standard EPUB CFI | 出版级 CFI | 以 `book.epub#epubcfi(...)` 形式引用 |
| Intra-Publication CFI | 出版物内部 CFI | 同一容器内文档间引用 |
| Step | 步骤 | 路径中的一段，如 `/4[body01]` |
| Offset | 终止步骤/偏移 | 精确到字符/时间/空间的最后一步 |
| Redirected Path | 间接路径/重定向路径 | `!`，跨文件跳转（CFI 1.1 新术语） |
| Assertion | 断言 | `[...]` 内的 ID 或文本 |
| Side Bias | 边界偏好 | 位置归属方向（`s=b` / `s=a`） |
| Virtual Element | 虚拟元素 | 索引 `0` 和 `n+2`（CFI 1.1 新增） |
| Text Node Collection | 文本节点集合 | 相邻文本节点的聚合 |
| Resolution | 解析 | 将 CFI 映射到文档实际位置 |
| Correction | 校正 | 文档更新后修复 CFI 的机制 |
| Character Offset | 字符偏移 | `:N`，UTF-16 代码单元 |
| Temporal Offset | 时间偏移 | `~N`，秒 |
| Spatial Offset | 空间偏移 | `@X:Y`，0-100% 百分比 |

## 附录：官方参考链接

| 资源 | 链接 |
|------|------|
| **EPUB CFI 1.1 规范**（Editor's Draft） | [w3c.github.io/epub-specs/epub33/epubcfi](https://w3c.github.io/epub-specs/epub33/epubcfi) |
| **EPUB CFI 最新发布版** | [w3.org/TR/epubcfi](https://www.w3.org/TR/epubcfi/) |
| **EPUB 3.3 核心规范** | [w3.org/TR/epub-33](https://www.w3.org/TR/epub-33/) |
| **EPUB 阅读系统 3.3** | [w3c.github.io/epub-specs/epub33/rs](https://w3c.github.io/epub-specs/epub33/rs) |
| **EPUB 规范 GitHub 仓库** | [github.com/w3c/epub-specs](https://github.com/w3c/epub-specs) |
| **EPUB CFI 1.0（IDPF 旧版）** | [idpf.org/epub/linking/cfi](https://idpf.org/epub/linking/cfi) |

---

> **文档版本**：v2.0 | **规范版本**：W3C EPUB CFI 1.1（2026-06-11）| **适用**：EPUB 3.x
> **修改记录**：v2.0 新增虚拟元素、更新 EBNF、重构跨文件定位章节、增加 CFI 1.0→1.1 变化汇总