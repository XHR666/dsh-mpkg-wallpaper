// jpeg-decode-test.mjs — P-67：`elysia/we-renderer/jpeg.js`（仓库自带纯 JS baseline JPEG 解码器）回归
//
// 背景（用户实测）：设备上报 `reports/r*.json` 的 `shot`（`canvas.toDataURL('image/jpeg',0.6)`，
// Chrome/Skia → baseline SOF0 4:2:0）用本解码器解出来只有顶部约 22% 有内容、其余近黑；
// 同一份字节流 ffmpeg 解出完整正确画面。⇒ 解码器错，不是截图坏。
// 根因：位读取器把 `FF 00` 字节填充整对丢掉，**数据字节 0xFF 本身没了** → 每遇一次少 8 bit →
// 位流错位 → DC 预测器发散。修复与全部改动见 `PATCHES.md` P-67 与 jpeg.js 顶部注释。
//
// 向量来源与期望值（全部离线一次性生成；**测试运行只读常量 + 上报文件，不依赖 ffmpeg、不联网**）：
//
// ① 真机截图（3 份，期望值逐像素对照过 ffmpeg；本文件只断言 ffmpeg 解出的特征量）
//      reports/r1789401975489.json  shot → 包 3554161528  2026-09-14T16:06:15Z  15006 B
//      reports/r1789401981021.json  shot → 包 3544152633  2026-09-14T16:06:21Z  19053 B
//      reports/r1789402095234.json  shot → 包 3326873240  2026-09-14T16:08:15Z  12883 B
//    提取（与 `node report-latest.mjs --id <pkg> --shot` 同款）：
//      const d = JSON.parse(fs.readFileSync('reports/rXXXX.json','utf8'))
//      fs.writeFileSync(path.join(os.tmpdir(), 'x.jpg'), Buffer.from(d.shot.split(',')[1], 'base64'))
//    期望值命令（离线）：
//      ffmpeg -v error -y -i /tmp/x.jpg -f rawvideo -pix_fmt rgba /tmp/x.raw
//      → 近黑占比(r,g,b<16) / 四角 RGB / 中心 17x17 均值；下表 expect 常量即 ffmpeg 输出。
//    对照（修复前 vs ffmpeg）：近黑 81.2/92.6/98.5 %，逐像素 MAE 128.41/89.12/67.66；
//    修复后：MAE 0.451/0.489/0.463（maxChDiff 5/10/11，纯 IDCT 取整差）。
//    报告文件缺失时本段计 SKIP（门禁条件项约定），合成向量仍照常断言。
//
// ② 合成向量（base64 内嵌本文件，含 SOF/DQT/DHT/DRI/SOS 全景；期望值同样先由 ffmpeg 校验）：
//      syn-rst-dri-16x16-gray.jpg  手写字节：DRI=2 + RST0，DC 预测器复位与否可观测
//      syn-420/422/444-64x48.jpg   Pillow 12.3.0，subsampling=2/1/0，quality=88 随机噪声
//                                  （熵流分别含 2/3/5 处 FF 00 填充 → 同时覆盖填充修复）
//      syn-restart-pil-48x32.jpg   Pillow restart_marker_blocks=1（DRI=1 + 5×RSTn，4:2:0）
//      syn-progressive-48x32.jpg   Pillow progressive=True（SOF2 → 必须显式抛错）
//    复现命令：python3 -c "from PIL import Image; ...; im.save('x.jpg', quality=88, subsampling=2)"
//
// ④ 真实受影响的渲染路径（[E] 段；依赖本机语料包，缺包自动跳过）：
//      全语料 11 包 / 213 个 .tex 只有 2 个 FIF=JPEG（`mm.fif===2`）——`3715743282`
//      materials/retouch_2026042801402539.tex (1920x1080 整屏底图) 与 `3721991999`
//      materials/洛琪希_130023460.tex (3897x2400 主体立绘)，都是各自场景的主图。
//      这两个正是 `elysia/we-renderer/textures.js:21 decodeJpeg(m.image)` 的唯一输入；
//      修复前两者都抛「invalid entropy stream」→ 被 decodeJpeg 吞成全黑 alpha=0 → 贴图 100% 透明。
//      期望值：同上 ffmpeg 离线解出的四角/中心/近黑（逐像素 MAE 0.47 / 0.57）。
//
// ③ 坏输入（截断 20~99% / 垃圾字节 / 仅 SOI+EOI / 空）：**必须抛明确错误**。
//    旧实现在 20%~99% 截断下一律安静返回半张图（近黑 77~81%、无异常），这正是本 PATCH 要杜绝的。
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { decodeJpeg } from '../elysia/we-renderer/jpeg.js'
// ①(去个人化 2026-09-16 / 敏感信息加固 2026-09-19) 工作区根：环境变量优先；兜底默认由 tests/_root.mjs 按**脚本自身位置**推导（不再写作者本机绝对路径）。
const MPW_WS = process.env.MPW_ROOT || WS

const SYN = {
  // ① 手写 baseline 灰度 16x16：SOF0 / DQT(全1) / DHT(DC 仅有 cat6, AC 仅有 EOB) / DRI=2 / RST0
  //    每块 8 bit：DC 码 '0' + 幅度 6 bit(=50) + AC EOB 码 '0' → 0x64
  //    间隔1 = 块0(+50) 块1(+50, 预测器=100) | RST0 | 间隔2 = 块2(+50) 块3(+50, 预测器=100)
  //    ⇒ DC 预测器**必须在 RST 处复位**：四象限 = DC/8+128 = 134/140/134/140。
  //    不复位则得 146/153（差 6~13）；不跳过 RST 标记则旧实现在这里抛 TypeError。
  rstDriGray: {
    name: 'syn-rst-dri-16x16-gray.jpg',
    b64: '/9j/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAAQABABAREA/8QAFAABAAAAAAAAAAAAAAAAAAAABv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/3QAEAAL/2gAIAQEAAD8AZGT/0GRk/9k=',
    w: 16, h: 16,
    expect: { nearBlackPct: 0, quad: [[134,134,134],[140,140,140],[134,134,134],[140,140,140]] },
    note: 'DRI=2 + RST0 (灰度, 无子采样)',
  },
  // ② Pillow 12.3.0 生成的 64x48 随机噪声 (quality=88)，三种色度采样各一份；
  //    熵流里分别含 2/3/5 处 FF 00 字节填充 (离线用 markers 脚本数出) → 同时覆盖填充修复
  syn420: {
    name: 'syn-420-64x48.jpg', b64: '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAQDAwMDAgQDAwMEBAQFBgoGBgUFBgwICQcKDgwPDg4MDQ0PERYTDxAVEQ0NExoTFRcYGRkZDxIbHRsYHRYYGRj/2wBDAQQEBAYFBgsGBgsYEA0QGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBj/wAARCAAwAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDH1M6bokGoWn9mrbw6gXhknnsvMlsmErbk+RE3kMHf58Sfv0b50USxbDAQWt5PYW1wtzBazaVcBblrOO1jlZw8cr2kUYwJIFw4VWZSiEoY32ya7aSv4csdB/tdobZrNpbNtUtsJa2axwoUJODEoUzo2zkx7lLDcmdGfxLosnhefWZLO9t7SzCyM6MY4bUTmOYLuQCV49v2csrqAQ3kgbwFqJyWLp05U/3jcmrpvm5W0m23bWVmrOSatpa3LKYZg4YhxlS5eZNxsr2u7LZ3ej0SlJR25krGKdGbV7nxEyX95p2iWFul4HnZ0WRFXZPGJUi3qFQJEDGhZTK8KZUNE9bUb42eq6R4h0pdb1CbTZYr4KWuXEDtLG88UzyQvE3+tdRKr+UnkqSSW5Sawjs/F13e6jajULcRSzSJZyQSNcwyGFlBKRN5eIDE/wA2wuMojoN6PMmleELlpIZUlaOaF5DN5wgguf3kq7h80TO6Bo/MlYIAsI3kiRivoVKtVKMZqSjFPVJtP7LWjjzNRbb25k2pxVmiJ1bNyrJy6J2veys7JJXbUU4yTu2parl0kjSbxLqtqqrctFZJeWkkmvWGAfn8pTK1vLscyTbwVXcXkaSLH7rm5eW1zc6b9m17RW1WbUQRBDJp5dpVmlV5FUQpmORiZJFKBirO4aPA8usXxTq934s0TTtVuJNJItWefTZordnn+1sFVIxLFIrK8sjghR8rqJmUscEVIjYf2zpzXXii3E9g093bT6LaxXESzSyLHPO0+EMiSRxSqfLxhvL25VUjOMcNXim6suW699e8+Ve9L4rX1utVaSWi+FyNqWFqSp8k/hTvaDu7q172vo1ZarlVna8o6bNuINHv4PCMMFtHaC3le4t5dRhh8z7jqVKHc3msvUOoDxxSEqU3M3QLDWdYit5dMju0awtVuJraFhLeLII4g08o88gDKjaBguhkULCxUq7w3rWp6voTmU3949pctfpDeWM6edKqTEys25EQZCplXGHhY4yiGrOoXc+v6t4h0O2h1FdaeSaOCUxNcQ2rMrmJhJjcu6ZYo98mVVUZHAaIGuWnz1udVYq+nvcr2ldNxT0stbKLUb73kkl0V6youXs0tZXlK6SSuryj3srKKVoqyV7tt5cVwdV1vWH1G51JLCN5fss1tqkMy3D5FuY9kQcSv9nNu+4LnJDfPuBrZtFlshaaBHNqN5eWEclvANOlx5UyAgt5rPsnVRGUKKm5Yy3lKNpdorG41fUrpNZW8FjftOPts8zfYL25ljjjCxvlk8yTb+7wsjAseQrtvOnf2Eyape3Imi1j+0S5u4I5pdz3LqkgjgLsqlWjMJdTE/8Aqwn3T5YipiOWXJSqcqb2/l0aVpNKKbTk0la+if2k+aN8TTtaN4Xa5n1cHpJp6Jaxak0221y390wbDWLnVNZSxXwzo1sIEaG0nu7zai24K7RFNFkq7MxVsHaV8tcM3ymVrbW7K6tZ9buRYaNPdfaEzeyqWjaPfIVfKg7phGNibzKFbbtUMGZeWjaDq91eWC3FzHaW0ttqkNoJ7dUuGl2wIsUbN5cspaOM5iZUfeAdo+SO4sY7K/kl0mVrCOztYL8Wlvp0VoWWdhHHCG27A+5bdd0rZYhwEyfLF04OrVVDDrlhJJStqvebg2otvlbv3fxN6OWnPKVCCtOakpXWjtbVJy/mWii4tJ3jbmdmmaOv2V9qWt2+gWWt2cNxDpx07UtON60kaWrRTh5ZnBBM0cckqiMlc+a0gOP3lNhNxcOsk+/QHmYgXcrPdfaCoBgSTy2BkI3nP3YsSgAMpikqDTdLtFSfQtLtb240/ULJlkEclthVjkZSyi4CoFjkduVyqGNo33hQIq11qUuprbabp9t5UY327WsZO6O6jlKw+aZQJRIHaVt0rqroj5yC6HahRrV6Fpq8qaTfNGLdlFNS1Ukm2na6krN2layW3I6uGUac97WbbSStyvSV5PWSfRR0nfVpQ+FtRE0k1hYRalNqN0sl19tWGeye3ijMgCSCPaiSEIQgYeXEHQRhnhKUyyYC60VI7F9TfTpvtFlNLqDTRSTb1zFCQ3lJwSHZDLh5Wl4UV2mqNqMHiK20bS9Rt7jVYr1yVm1FDPZwloSq7ZonjEQBjCxGNXUrHsLsWVeG0tHd7nTml3WFvHJKTLO0E8VvIzMVw7CNncyStunPlxlW5PmOtTgp0aFGtiubZp3vdWalFbOy09y15ac1pX5XKsRmHJKS6dmm97a6vWykmouUbxi7rV30oLTULjWl8Kapp8umfZYJrlrsbopblGjwJjJ5Wx2iMwxvZD13gsXDaun+St/a2bapYadpzxDUZTdhTHeK0MqB0cRhJfPkLnB8shMnYCSK4yOyu9U0GG9vL3UNOuni+0PbtHmOR1WE7RHD87nZJErSn5iYlzlRlelbWE1WyHirXbS4Sz1GzNlDqM7CZi9y/kqDJ5oSMxuvzM4bKQscxebsGmY0uWnyVFe6aVouyk21aKd1zO7m7Ntpa+67J+yp0lFznGMnz6W0U0mtL7xldprWScWpSukjQtraKLSotJ0OeLR7OS7hspvL08xxCAhkWFmclpJePmI805lXeoYsVy38QyaRrHlytc3d9aTNPb6fM8bk+ewkkDuWRURgVXzIiVBmJ8pQqZm0S103U9dn8Q+GZ11O6uJXjjgtLEW9pbwSJKhXMm4MvySuMCOMO7ozPuRaZYrfaR4hstIm8NRSWiraxyS3VzGyJET+/aIEuGwgB2fMAlpK5LkKzc8I06bm8RPbR7puVkubX35StdfFfqldMmE3hORVpc8YqNrrla+zzNXsk4xXMneT0Sdmm69jLNYWJ1zw9fW91Mwaw0/SJY/KeVWlkjlEqsEcqjvIDIQMt5gKnOH0pbtJbxNJgu7HTdRspUghudF1Oztn06R0ZmVoi+9YXCIfm3MjJzsCENQ1y28cPo7y61punMkqPPFHLHcWxu3WXaIlSdDE627JcM0RIHkSZ3HdT7Tw/qmob21GG7u7eaaW1vdQhSSD7Obi4hiUshjCh/LIKJuVEBJCbQhYqwlVg60azlduLkrSv25ruKavtdJ++1qtlVdNwvUUb2bjZcr6LpZ81tFJtrXlafKuW6Wj16xXUrW2guNKmt/Ij020uXuUdij3vl+XHIkZfzGKCPaWKOAEG05qRwXOs28MWhtbWd7JpsS2s891HIs0ke2e7hjmhV/MwJJHfasb7iCq+WCyOu9EuNX8N3EN3fz2dyJYLTUzYqocCS2KM3mwhljQiSeNw8bHagJBKmq1vZQ/8JBZ2ltdWVxZ6hFi0vJ3hQtGqugCxyqFjjZsIxjGwRoqtJK/yru4TlJ0sPJyUU731jaKbSTd9XLS+7V7Wbckq1ZSlKrN80JarflaVpctpT6Stfmt9pPaKj//2Q==', w: 64, h: 48,
    expect: { nearBlackPct: 0.00, corners: [[100,113,205],[229,168,147],[154,70,147],[87,154,145]], center: [123.9,129.9,129.0] },
    note: '4:2:0 (2x2,1x1,1x1)',
  },
  syn422: {
    name: 'syn-422-64x48.jpg', b64: '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', w: 64, h: 48,
    expect: { nearBlackPct: 0.00, corners: [[79,48,0],[83,113,165],[0,28,0],[103,180,133]], center: [129.8,135.3,134.1] },
    note: '4:2:2 (2x1,1x1,1x1)',
  },
  syn444: {
    name: 'syn-444-64x48.jpg', b64: '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', w: 64, h: 48,
    expect: { nearBlackPct: 0.07, corners: [[222,7,225],[119,12,186],[70,37,186],[142,130,70]], center: [125.5,122.9,127.0] },
    note: '4:4:4 (1x1,1x1,1x1)',
  },
  // ③ Pillow restart_marker_blocks=1：DRI=1 + 5 个 RSTn，且是 4:2:0（RST 与子采样同时生效）
  synRestartPil: {
    name: 'syn-restart-pil-48x32.jpg', b64: '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAgADADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/90ABAAB/9oADAMBAAIRAxEAPwD5yt9P6cVp2+n9OK3LfT+nFalvp/TilCoc+DzDzP/Q8Zt9P6cVp2+n9OK3LfT+nFalvp/TiuuFQ+hweYeZ/9HgLfT+nFalvp/Tity30/pxWnb6f04r14VD9LweY+Z//9LkbfT+nFadvp/Tity30/pxWpb6f04rz4VD89weY+Z//9OC30/pxWnb6f04rct9P6cVqW+n9OKzhUPGweY+Z//U6C30/pxWpb6f04rbt9P6cVqW+n9OK6IVD0cHmPmf/9k=', w: 48, h: 32,
    expect: { nearBlackPct: 0.65, corners: [[2,0,1],[233,3,138],[2,213,96],[231,216,234]], center: [120.2,111.4,120.6] },
    note: 'DRI=1 + 5xRSTn, 4:2:0',
  },
  // ④ 渐进式 (SOF2)：不支持 → 必须显式抛错（不许静默半张图）
  progressive: { name: 'syn-progressive-48x32.jpg', b64: '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wgARCAAgADADASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABAUH/8QAFwEBAQEBAAAAAAAAAAAAAAAAAwUBB//aAAwDAQACEAMQAAABzhTlYYUuU1QKnKarGS5UznIVOU1QKmqar//EABYQAAMAAAAAAAAAAAAAAAAAAAACA//aAAgBAQABBQJZizFmLMWYsxZizFmLMWYsxZizFmLMWYsxZizFmLMWYsz/xAAWEQADAAAAAAAAAAAAAAAAAAAAAwT/2gAIAQMBAT8BTQJoE0CaBNAmg//EABYRAAMAAAAAAAAAAAAAAAAAAAABAv/aAAgBAgEBPwFUKhUKhUKj/8QAFBABAAAAAAAAAAAAAAAAAAAAQP/aAAgBAQAGPwJH/8QAFBABAAAAAAAAAAAAAAAAAAAAQP/aAAgBAQABPyFAAAAAAAAH/9oADAMBAAIAAwAAABCJ/tyE3//EABURAQEAAAAAAAAAAAAAAAAAAABh/9oACAEDAQE/EKKKqqqv/8QAFBEBAAAAAAAAAAAAAAAAAAAAIP/aAAgBAgEBPxBVVf/EABYQAAMAAAAAAAAAAAAAAAAAAAAhMf/aAAgBAQABPxCCIIgiCIIgiCIIgiCIIgiCIIgiCIIgiCIIgiCIIgj/2Q==', w: 48, h: 32, throws: /progressive/i, note: 'SOF2 渐进式' },
};

// ───────────────────────── 小工具 ─────────────────────────
let PASS = 0, FAIL = 0
const ok = (cond, label, detail = '') => {
  if (cond) { PASS++; console.log('  ✓ ' + label + (detail ? '  ' + detail : '')) }
  else { FAIL++; console.log('  ✗ ' + label + (detail ? '  ' + detail : '')) }
}
const nearBlackPct = (r, w, h) => {
  let n = 0
  for (let i = 0; i < w * h; i++) if (r.rgba[i * 4] < 16 && r.rgba[i * 4 + 1] < 16 && r.rgba[i * 4 + 2] < 16) n++
  return (100 * n) / (w * h)
}
const px = (r, x, y) => { const o = (y * r.width + x) * 4; return [r.rgba[o], r.rgba[o + 1], r.rgba[o + 2]] }
const cornersOf = (r) => [px(r, 0, 0), px(r, r.width - 1, 0), px(r, 0, r.height - 1), px(r, r.width - 1, r.height - 1)]
const boxMean = (r, cx, cy, rad) => {
  const s = [0, 0, 0]; let n = 0
  for (let y = cy - rad; y <= cy + rad; y++) for (let x = cx - rad; x <= cx + rad; x++) {
    const o = (y * r.width + x) * 4; s[0] += r.rgba[o]; s[1] += r.rgba[o + 1]; s[2] += r.rgba[o + 2]; n++
  }
  return s.map((v) => v / n)
}
const alphaOpaque = (r) => { for (let i = 3; i < r.rgba.length; i += 4) if (r.rgba[i] !== 255) return false; return true }
const throws = (fn) => { try { const r = fn(); return { threw: false, r } } catch (e) { return { threw: true, msg: String((e && e.message) || e) } } }
const CORNER_TOL = 5, CENTER_TOL = 3, NEAR_TOL = 1.0

/** 通用向量断言：尺寸 / 近黑占比 / 四角 / 中心均值 / alpha 全不透明 */
function checkImage(label, r, v) {
  ok(r.width === v.w && r.height === v.h, `${label} 尺寸`, `got ${r.width}x${r.height} want ${v.w}x${v.h}`)
  const got = cornersOf(r)
  const want = v.expect.corners
  for (let i = 0; i < 4; i++) {
    const d = got[i].map((c, j) => Math.abs(c - want[i][j]))
    ok(Math.max(...d) <= CORNER_TOL, `${label} 角${['左上', '右上', '左下', '右下'][i]}`,
      `got (${got[i]}) want (${want[i]}) Δ${Math.max(...d)}`)
  }
  const nb = nearBlackPct(r, r.width, r.height)
  ok(Math.abs(nb - v.expect.nearBlackPct) <= NEAR_TOL, `${label} 近黑占比`,
    `got ${nb.toFixed(2)}% want ${v.expect.nearBlackPct}%`)
  const cm = boxMean(r, r.width >> 1, r.height >> 1, Math.min(8, r.width >> 2))
  const dd = Math.max(...cm.map((c, j) => Math.abs(c - v.expect.center[j])))
  ok(dd <= CENTER_TOL, `${label} 中心均值`, `got (${cm.map((x) => x.toFixed(1))}) want (${v.expect.center}) Δ${dd.toFixed(1)}`)
  ok(alphaOpaque(r), `${label} alpha 全 255`)
}

const reportDirs = [
  process.env.MPW_REPORTS,
  process.env.MPW_ROOT && path.join(process.env.MPW_ROOT, 'reports'),
  path.resolve('..', 'reports'),
  `${MPW_WS}/reports`,
].filter(Boolean)

function loadShot(file) {
  for (const dir of reportDirs) {
    const p = path.join(dir, file)
    if (!fs.existsSync(p)) continue
    const d = JSON.parse(fs.readFileSync(p, 'utf8'))
    if (!d.shot) return { err: 'shot 字段缺失' }
    return { buf: new Uint8Array(Buffer.from(String(d.shot).replace(/^data:image\/jpeg;base64,/, ''), 'base64')), path: p }
  }
  return null
}

const SHOTS = [
  { file: 'r1789401975489.json', pkg: '3554161528', at: '2026-09-14T16:06:15Z', bytes: 15006, w: 480, h: 270,
    expect: { nearBlackPct: 0.00, corners: [[129, 31, 54], [230, 76, 144], [75, 80, 159], [129, 126, 207]], center: [219.9, 121.5, 186.1] } },
  { file: 'r1789401981021.json', pkg: '3544152633', at: '2026-09-14T16:06:21Z', bytes: 19053, w: 480, h: 270,
    expect: { nearBlackPct: 1.23, corners: [[6, 16, 39], [16, 11, 33], [0, 3, 8], [0, 2, 15]], center: [203.9, 116.3, 168.1] } },
  { file: 'r1789402095234.json', pkg: '3326873240', at: '2026-09-14T16:08:15Z', bytes: 12883, w: 480, h: 270,
    expect: { nearBlackPct: 2.48, corners: [[0, 20, 151], [4, 12, 25], [11, 12, 54], [85, 96, 201]], center: [1.6, 25.3, 176.3] } },
]
const shotsLoaded = SHOTS.map((s) => ({ s, got: loadShot(s.file) }))
const missShots = shotsLoaded.filter((x) => !x.got || x.got.err || x.got.buf.length !== x.s.bytes)
if (missShots.length) {
  // 门禁条件项约定：首 3 行出现 "SKIP jpeg-decode" 且退出 0 → 计 SKIP（无数据不红）
  console.log('SKIP jpeg-decode（真机截图样本缺失/字节数不符：'
    + missShots.map((x) => x.s.file + (x.got && x.got.err ? '(' + x.got.err + ')' : '')).join(', ')
    + '；合成向量仍然断言）')
}

// ─────────────── A. 合成向量（内嵌 base64） ───────────────
console.log('\n[A] 合成向量（4:2:0 / 4:2:2 / 4:4:4 / DRI+RST / 渐进式）')
for (const [key, v] of Object.entries(SYN)) {
  const buf = new Uint8Array(Buffer.from(v.b64, 'base64'))
  if (v.throws) {
    const t = throws(() => decodeJpeg(buf))
    ok(t.threw && v.throws.test(t.msg), `${key} (${v.note}) 显式抛错`, t.threw ? t.msg : '静默返回了图像')
    continue
  }
  console.log(` · ${key} → ${v.name} (${buf.length} B, ${v.note})`)
  const t = throws(() => decodeJpeg(buf))
  if (t.threw) { ok(false, `${key} 解码抛错`, t.msg); continue }
  ok(true, `${key} 解码成功`, `${t.r.width}x${t.r.height}`)
  if (v.expect.corners) checkImage(key, t.r, v) // rstDriGray 的四象限在 [B] 段精确断言
}

// ─────────────── B. DRI + RST 精确断言（DC 预测器复位） ───────────────
console.log('\n[B] DRI=2 + RST0：DC 预测器必须在 restart 边界复位（象限 = DC/8+128）')
{
  const v = SYN.rstDriGray
  const t = throws(() => decodeJpeg(new Uint8Array(Buffer.from(v.b64, 'base64'))))
  if (t.threw) ok(false, 'rstDriGray 解码', t.msg)
  else {
    const r = t.r
    // 象限中心：块0/块2 = +50 → 134；块1/块3 = 累计 100 → 140
    const quad = [px(r, 4, 4), px(r, 12, 4), px(r, 4, 12), px(r, 12, 12)]
    for (let i = 0; i < 4; i++) {
      const want = v.expect.quad[i]
      const d = Math.max(...quad[i].map((c, j) => Math.abs(c - want[j])))
      ok(d <= 1, `象限${['左上', '右上', '左下', '右下'][i]} = DC/8+128`, `got (${quad[i]}) want (${want})`)
    }
    ok(alphaOpaque(r), 'rstDriGray alpha 全 255')
    // 复位失败（不复位 DC 预测器）会得到 146/153；跳过 RST 标记则整体错位 → 上面 4 条即判据
  }
}

// ─────────────── C. 真机截图（ffmpeg 离线核对过的常量） ───────────────
console.log('\n[C] 真机截图（reports/r*.json 的 shot，Chrome baseline SOF0 4:2:0）')
for (const { s, got } of shotsLoaded) {
  if (!got || got.err || got.buf.length !== s.bytes) { console.log(` · ${s.file} 跳过（样本缺失）`); continue }
  console.log(` · ${s.file} 包=${s.pkg} ${s.at} ${got.buf.length} B`)
  const t = throws(() => decodeJpeg(got.buf))
  if (t.threw) { ok(false, `${s.file} 解码`, '抛错: ' + t.msg); continue }
  checkImage(s.file, t.r, s)
  const nb = nearBlackPct(t.r, t.r.width, t.r.height)
  ok(nb < 5, `${s.file} 无「顶部一条+其余近黑」签名`, `近黑 ${nb.toFixed(2)}% < 5%（修复前 81.2% / 92.6% / 98.5%）`)
}

// ─────────────── D. 坏输入必须抛错，不许静默半张图 ───────────────
console.log('\n[D] 坏输入：必须显式抛错（旧实现在截断时静默返回半张图）')
{
  const src = shotsLoaded.find((x) => x.got && x.got.buf && x.got.buf.length === x.s.bytes)
  if (!src) { console.log(' · 无真机截图样本 → 截断用例跳过（合成向量部分已断言）') }
  else {
    for (const frac of [0.2, 0.4, 0.6, 0.9, 0.99]) {
      const cut = src.got.buf.subarray(0, Math.floor(src.got.buf.length * frac))
      const t = throws(() => decodeJpeg(new Uint8Array(cut)))
      ok(t.threw && /truncated|entropy|missing|restart/i.test(t.msg), `截断 ${frac * 100}% → 抛错`,
        t.threw ? t.msg : '静默返回半张图（不可接受）')
    }
  }
  const bad = [
    ['垃圾字节', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), /bad SOI/i],
    ['仅 SOI+EOI', new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), /missing SOF\/SOS/i],
    ['空数组', new Uint8Array(0), /bad SOI/i],
    ['渐进式', new Uint8Array(Buffer.from(SYN.progressive.b64, 'base64')), /progressive/i],
  ]
  for (const [label, buf, re] of bad) {
    const t = throws(() => decodeJpeg(buf))
    ok(t.threw && re.test(t.msg), `${label} → 抛明确错误`, t.threw ? t.msg : '静默返回')
  }
  // 截断样本绝不允许返回「全透明 / 大面积近黑」的结果冒充成功
  if (src) {
    const t = throws(() => decodeJpeg(new Uint8Array(src.got.buf.subarray(0, 6000))))
    ok(t.threw, '截断样本不返回透明图', t.threw ? '已抛错' : '静默返回（旧行为）')
  }
}

// ─────────────── E. 真实受影响的渲染路径：.tex 里 FIF=JPEG 的贴图 ───────────────
// elysia/we-renderer/textures.js:21 `decodeJpeg(m.image)`（唯一调用点，grep 全仓只有这里 +
// core.js:174 loadTexImage 间接调用）。全语料 11 包 / 213 个 .tex 里只有 2 个 FIF=JPEG（mm.fif===2），
// 就是下面这两个；修复前它们都走「熵流错误 → 全黑 rgba(alpha=0) → 贴图 100% 透明」，
// 而这两个恰好是各自场景的**主图**（3715743282 是整屏底图 1920x1080；3721991999 是主体立绘 3897x2400）。
// 期望值同样来自 ffmpeg（-f rawvideo -pix_fmt rgba）+ 我们自己的解码器离线对照（MAE 0.47 / 0.57）。
console.log('\n[E] 真实 FIF=JPEG 贴图（elysia 路径 textures.js:21 唯一调用点）')
const CORPUS = [
  { id: '3715743282', tex: 'materials/retouch_2026042801402539.tex', w: 1920, h: 1080,
    expect: { corners: [[240, 250, 237], [255, 255, 255], [173, 199, 98], [245, 245, 171]], center: [250.3, 250.7, 232.0], nearBlackPct: 0.00 } },
  { id: '3721991999', tex: 'materials/洛琪希_130023460.tex', w: 3897, h: 2400,
    expect: { corners: [[24, 14, 49], [30, 14, 40], [17, 14, 41], [16, 19, 36]], center: [127.4, 120.9, 172.6], nearBlackPct: 0.31 } },
]
{
  const roots = [process.env.MPW_ROOT && path.join(process.env.MPW_ROOT, 'allwallpaper', 'dd'), path.resolve('..', 'allwallpaper', 'dd')].filter(Boolean)
  let lib = null, firstErr = null
  const pkgPath = (id) => { for (const r of roots) { const p = path.join(r, id, 'scene.pkg'); if (fs.existsSync(p)) return p } return null }
  const real = CORPUS.filter((c) => pkgPath(c.id))
  if (real.length === 0) console.log(' · 跳过：语料包不在本机（用 MPW_ROOT 指定根目录）')
  else {
    try { lib = await import('../core/we-scene-bundle.js') } catch (e) { firstErr = e }
    if (firstErr) console.log(' · 跳过：core/we-scene-bundle.js 不可用（' + firstErr.message + '）')
  }
  if (lib) for (const c of real) {
    const pkg = lib.parsePkg(fs.readFileSync(pkgPath(c.id)))
    const raw = lib.getEntry(pkg, c.tex)
    ok(!!raw, `${c.id} .tex 入口存在`, c.tex)
    if (!raw) continue
    const m = lib.decodeMip0(lib.parseTex(raw))
    ok(m.fif === lib.FIF.JPEG, `${c.id} FIF=JPEG`, 'fif=' + m.fif)
    const t = throws(() => decodeJpeg(m.image))
    if (t.threw) { ok(false, `${c.id} 贴图解码`, t.msg); continue }
    checkImage(`${c.id} ${c.tex}`, t.r, c)
    const nb = nearBlackPct(t.r, t.r.width, t.r.height)
    ok(!(nb > 90 && t.r.rgba[3] === 0), `${c.id} 非「全透明兜底图」`, `近黑 ${nb.toFixed(2)}% alpha0=${t.r.rgba[3] === 0}（修复前 100% alpha=0）`)
    ok(t.r.width === c.w && t.r.height === c.h, `${c.id} 声明尺寸`, `${t.r.width}x${t.r.height}`)
  }
}

console.log(`\n══ jpeg-decode: PASS=${PASS} FAIL=${FAIL}`)
process.exit(FAIL > 0 ? 1 : 0)
