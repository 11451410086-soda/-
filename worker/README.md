# 联机信令 · Cloudflare Worker 版

> ⚠️ **重要： 在国内网络通常被墙**。实测同一台机器  能通（200），
> 但  直接连接失败，游戏也一样连不上。
>
> 所以本目录的代码**默认不启用**，线上仍用 Render（配合页面保活）。
> 只有在满足以下条件时才值得切过来：
> - 给 Worker 绑定一个自己的域名（ 换成自定义域），或
> - 玩家都在能访问 workers.dev 的网络里。

Render 免费实例闲置 15 分钟会休眠，冷启动要 30~60 秒。这个 Worker 版**不会睡**，部署完把地址换掉即可。

## 部署（一次性，大约 2 分钟）

```bash
cd worker
npx wrangler login      # 浏览器里点一下同意
npx wrangler deploy
```

`wrangler deploy` 成功后会打印地址，形如：

```
https://jie-yu-jing-hua.<你的子域>.workers.dev
```

## 验证

浏览器打开上面这个 https 地址，应该看到：

```
jie-yu-jing-hua signaling ok
```

## 切换到它

两种方式：

1. **临时验证**：游戏地址后面加 `&signal=wss://jie-yu-jing-hua.<你的子域>.workers.dev`
   ```
   https://11451410086-soda.github.io/-/?p2p=1&room=ABCD&role=host&signal=wss://xxx.workers.dev
   ```
2. **永久切换**：把地址发给开发者（或自己改 `vite.config.ts` 的 `VITE_SIGNAL_URL` 后重新构建部署）
   ```
   VITE_SIGNAL_URL=wss://jie-yu-jing-hua.<你的子域>.workers.dev npm run build
   ```

## 说明

- 房间、转发逻辑和 Render 版完全一致（`p2p-join` / `p2p-offer` / `p2p-answer` / `p2p-ice`）
- 全部房间跑在同一个 Durable Object 里，这个体量（双人 PvE）完全够
- 免费额度：Workers 每天 10 万请求，Durable Objects 免费额度对局用不完
