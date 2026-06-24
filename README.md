# Discord CSV2ASS

Discord のチャットログ CSV を、動画編集や字幕焼き付けに使える ASS 字幕ファイルへ変換する Windows 向けデスクトップアプリ。

[DiscordChatExporter](https://github.com/tyrrrz/discordchatexporter) で書き出した CSV を読み込み、流れるコメント風の字幕をプレビューしながら調整できます。

## できること

- [DiscordChatExporter](https://github.com/tyrrrz/discordchatexporter) の CSV を読み込んで ASS ファイルへ変換
- フォント、文字サイズ、色、太字、影、表示時間の調整
- コメントを流す高さや開始時刻の調整
- プレビューを見ながら見た目を確認
- 生成した ASS を保存して [HandBrake](https://handbrake.fr/downloads.php) などで焼き付け

## 使い方

### 1. DiscordChatExporter で CSV を用意する

まず、Discord のログを CSV 形式で出力します。

1. [DiscordChatExporter](https://github.com/tyrrrz/discordchatexporter) を起動する
2. 出力したいサーバーやチャンネルを選ぶ
3. CSV で EXPORT する
4. 任意の保存先に CSV を保存する

このアプリは、[DiscordChatExporter](https://github.com/tyrrrz/discordchatexporter) から出力した CSV を前提にしています。

### 2. このアプリで CSV を読み込む

1. `Discord CSV2ASS` を起動する
2. CSV ファイル選択ボタンから、先ほど保存した CSV を読み込む
3. プレビューを見ながら表示設定を調整する
4. `ASSファイルを生成して保存` を押す
5. 保存先を選んで `.ass` ファイルを書き出す

### 3. 動画に字幕を反映する

書き出した ASS ファイルは、字幕対応ソフトで利用できます。

例:

- [HandBrake](https://handbrake.fr/downloads.php) などで動画に焼き付ける
- ASS 対応プレイヤーで字幕として読み込む
- 動画編集ソフト側で追加素材として使う

## 操作の流れ

1. [DiscordChatExporter](https://github.com/tyrrrz/discordchatexporter) で CSV をダウンロード
2. このアプリで CSV を読み込む
3. 字幕の見た目を調整する
4. ASS ファイルを書き出す
5. 動画に焼き付ける、または字幕として読み込む

## 使用技術

- Electron
  - Windows デスクトップアプリ化
- HTML
  - 画面構造の構築
- CSS
  - UI デザイン、レイアウト、プレビュー表示
- JavaScript
  - CSV 読み込み、字幕生成、プレビュー制御
- electron-packager
  - アプリ本体のビルド
- electron-winstaller
  - Windows インストーラーの作成
- Squirrel.Windows
  - インストール、アンインストール、ショートカット作成の補助
- Claude, Gemini, Codex
  - 開発の補助
