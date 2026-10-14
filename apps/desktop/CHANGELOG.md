# Changelog

## [0.2.0](https://github.com/csdev19/port-watcher/compare/desktop-v0.1.0...desktop-v0.2.0) (2026-10-14)


### Features

* **desktop:** add first-run setup window with Full Disk Access flow ([3c68ec6](https://github.com/csdev19/port-watcher/commit/3c68ec6b92285c9687b86cf09a06581602d43256))
* **desktop:** add the Settings About screen with an on-click update check ([1eff762](https://github.com/csdev19/port-watcher/commit/1eff762d6bb5bf727f618558baeb9427bdfbd4af))
* **desktop:** add the Settings window shell ([2631227](https://github.com/csdev19/port-watcher/commit/263122767d254b00a1c4ad00b3d1edaf8ba06c48))
* **desktop:** build the General settings screen ([397bd8e](https://github.com/csdev19/port-watcher/commit/397bd8e728f92df99484e623deba59968596e82b))
* **desktop:** build the Settings Ports screen ([b711b0a](https://github.com/csdev19/port-watcher/commit/b711b0aa4a609467fcefdbf1e7ca83359e6277db))
* **desktop:** first-run Full Disk Access window and project names in rows ([35c5127](https://github.com/csdev19/port-watcher/commit/35c5127a54450ca7bf4afbf362e3d07e34fd07b8))
* **desktop:** gate project detection on Full Disk Access and add setup window plumbing ([8dd5c42](https://github.com/csdev19/port-watcher/commit/8dd5c422467403ac6bce015655aaf7d963576984))
* **desktop:** in-app updates with a panel banner (ADR 0007) ([ad42168](https://github.com/csdev19/port-watcher/commit/ad42168140138c7b99def7a661bd37c48c7e26ac))
* **desktop:** install updates in-app through tauri-plugin-updater ([f34ac84](https://github.com/csdev19/port-watcher/commit/f34ac845c16dee64e3c0ee5d67eb3088831c31b8))
* **desktop:** make the panel shortcut changeable at runtime ([38ff081](https://github.com/csdev19/port-watcher/commit/38ff08169e078b03e51a2402134ba2fd698a5101))
* **desktop:** open Settings from a gear in the panel and with ⌘, ([a9b21e8](https://github.com/csdev19/port-watcher/commit/a9b21e80b36c592607a024e5e51978117823a0ed))
* **desktop:** Settings Permissions screen with live Full Disk Access status ([7b084d6](https://github.com/csdev19/port-watcher/commit/7b084d6512aa190bb640125788df1e5c89a241c2))
* **desktop:** show the project name next to the path in port rows ([8cfc2d2](https://github.com/csdev19/port-watcher/commit/8cfc2d29d2de1db91c55bc799e09c378ecce721c))
* **desktop:** wire confirm-before-kill and show-apps-and-system into the panel ([5e8c256](https://github.com/csdev19/port-watcher/commit/5e8c2565da04a050fcb4826443bdbc7fee835738))
* sign chapay as a Niway product built by csdev ([bc450c6](https://github.com/csdev19/port-watcher/commit/bc450c69cf6407abff6e9767c9ae7d9928536479))


### Bug Fixes

* **desktop:** bump rustls to 0.23.46 for RUSTSEC-2026-0346..0349 ([6c25ba6](https://github.com/csdev19/port-watcher/commit/6c25ba6e5891e6d01c76fe4ade2f4500b350b9cd))
* **desktop:** bump rustls to 0.23.46 for RUSTSEC-2026-0346..0349 ([f069098](https://github.com/csdev19/port-watcher/commit/f06909836804376a33849d27102654cd2bf4a5bc))
* **desktop:** do not kill on cmd+backspace inside the search input ([292e64d](https://github.com/csdev19/port-watcher/commit/292e64db350b909d5f24bb2199472ececd083172))
* **desktop:** enforce the kill policy in Rust and confirm the kill ([9de9d24](https://github.com/csdev19/port-watcher/commit/9de9d24961d7a99206a91fba79c99d69d5fd1402))
* **desktop:** make the ⌥⌘P shortcut toggle the panel ([86f31d7](https://github.com/csdev19/port-watcher/commit/86f31d7f441b74f3b4ed7d8a9d10bd869bc06797))
* **desktop:** make the panel a non-activating NSPanel placed in logical points ([5dde65a](https://github.com/csdev19/port-watcher/commit/5dde65a24ea57a5d15f048a9a2b226a51b3e757b))
* **desktop:** match the home directory on a path boundary in tildify ([43e2f0b](https://github.com/csdev19/port-watcher/commit/43e2f0bb4f0b144b548079d55883933247720a48))
* **desktop:** open the panel on a tray left click instead of the menu ([f8812ef](https://github.com/csdev19/port-watcher/commit/f8812ef7638f8a173c0ce85027aceaee251cb526))
* **desktop:** open the panel on the active Space, including full-screen apps ([42f7e30](https://github.com/csdev19/port-watcher/commit/42f7e30495dc1a06db7fd090011b4ca1db989786))
* **desktop:** open the panel on the active Space, including full-screen apps ([489203a](https://github.com/csdev19/port-watcher/commit/489203a7eca80fb1702272230a5c4e095a8833c8))
* **desktop:** place the panel under the tray icon on the first ⌥⌘P ([65d6268](https://github.com/csdev19/port-watcher/commit/65d6268f0317448842e270262a2edbf06cc21847))
* **desktop:** set a real CSP and drop the unused opener permission ([f252035](https://github.com/csdev19/port-watcher/commit/f252035f49c91afab0b747d812f299c975a7608a))
* **desktop:** stop project detection from touching TCC-protected folders ([77ce345](https://github.com/csdev19/port-watcher/commit/77ce345e03aba68d4d158f30445472b12acd03f5))
* post-0.1.0 audit batch 1, user-facing fixes (NIW2-345) ([cf2594c](https://github.com/csdev19/port-watcher/commit/cf2594cfbcec08273f5152b08d86ab0c5295871b))
* post-0.1.0 audit batch 2, kill hardening, CI and release safety (NIW2-345) ([e3319d8](https://github.com/csdev19/port-watcher/commit/e3319d844c1cf825efdae58f6e4b2ed5317fcd0f))
* tray left click opens the panel, web favicon ([bff87b9](https://github.com/csdev19/port-watcher/commit/bff87b92fbce9b65cfe7114257b216432135f853))

## 0.1.0 (2026-10-12)


### Bug Fixes

* **desktop:** Dock icon at launch, bundle metadata, and 0.1.0 initial releases ([640b3bb](https://github.com/csdev19/port-watcher/commit/640b3bbb4de4bd94706ac464f4a2af5eab1da6e5))
* **desktop:** hide the Dock icon from launch and add bundle metadata ([33277c3](https://github.com/csdev19/port-watcher/commit/33277c3dd775848d084dd24981c7f6564eec3ad6))
