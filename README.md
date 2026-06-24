# Discord CSV2ASS

Discord の CSV ログを ASS 字幕ファイルに変換する Windows 向けデスクトップアプリです。

## 配布用ファイル

ビルド済みインストーラーは次に出力されます。

- `dist/installer/DiscordCSV2ASS-Setup.exe`

GitHub では、この `.exe` をリポジトリ本体ではなく `Releases` に添付して配布するのがおすすめです。

## 開発

```bash
npm install
npm start
```

## ビルド

```bash
npm run build
npm run build-installer
```

## GitHub への公開手順

1. このフォルダを GitHub の新規リポジトリに push する
2. `dist/installer/DiscordCSV2ASS-Setup.exe` を作成する
3. GitHub の `Releases` で新しいリリースを作る
4. `DiscordCSV2ASS-Setup.exe` を添付して公開する

ソースコードと配布ファイルを分けて管理できるので、リポジトリが重くなりにくく、更新もしやすくなります。
