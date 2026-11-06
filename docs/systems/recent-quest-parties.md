# 查看最近编队

`POST /quest/get_recent_other_player_party` 按 `category + quest_id` 返回本服务器所有玩家在该关卡最近一次成功结算的编队，按结算先后倒序排列。列表包含查看者自己的记录，不要求关注关系；不截取前 10 人，也不按时间过期。每位玩家、每个关卡最多保留一条，新通关覆盖旧记录，因此持续刷关不会增加同一玩家的行数。

## 记录与读取

- 单人和多人 `/finish` 在各自结算事务内写入 `recent_quest_parties`；失败、退出、未通过结算验证的请求不发布编队。剧情中允许败北即通关的关卡沿用结算的通关判定。
- 角色、武器和魂珠来自此次结算的 `statistics.party`，不会用玩家当前选择的槽位替换实际参战阵容。只有全阵容匹配时才采用存档里的队伍名，否则使用“玩家名的通关编队”。战力使用客户端的 `statistics.max_power`，缺省为 0。
- 头像立绘在结算时读取该角色的 `illustrationSettings[1]`，未设置时使用进化等级（最多 1）。不持有的固定角色使用默认头像。后续修改编队或角色立绘不会改写历史。
- 同一 `play_id` 重试不更新已有记录。SQLite 回滚同时撤销记录，重启保留记录；排序使用递增写入序号，服务器虚拟时间调整不会颠倒顺序。
- 记录属于服务器共享状态，不随个人存档导出、导入或克隆；删除所属玩家时通过外键级联删除。数据库启动时自动补表，旧服无需手工 SQL。此前未保存实际编队的通关无法恢复，更新后需要重新通关产生记录。
- 多人 Hub 的每个所属节点只记录该节点完成结算的玩家，不同步其他服务器的数据库，也不为 NPC 生成记录。

## 客户端协议证据

本地 CN 1.8.1 APK 的 `assets/worldflipper_android_release.swf`：

- `QuestGetRecentOtherPlayerPartyRealRemote.successHandler` 要求 `recent_other_player_party` 为数组，每项包含字符串 `party_name`、整数 `power`，以及三组可空整数 `character_id_N`、`unison_character_id_N`、`equipment_id_N`、`ability_soul_id_N`、`evolution_img_level_N`、`unison_evolution_img_level_N`。
- `BattleClearParameter.getStatistics()` 上报 `max_power` 和 `party` 中的角色、装备、魂珠 ID，不上报队伍名或角色养成状态。
- `BattleCharacterLogic.getFaceImagePath()` 使用立绘设置索引 1；没有设置时使用最高为 1 的进化等级。
- `RecentOtherPlayerPartyLogic.toCopySourcePartyData()` 使用上述阵容 ID 创建复制来源。因此恢复列表后可沿用客户端现有的查看、复制流程，无需修改 APK。

客户端 dummy repository 的 10 条上限、隐藏自己属于本地模拟行为，不能证明官服规则。本实现按全服共享需求，采用包含自己、每玩家每关一条、返回全部玩家的策略。官方响应没有玩家姓名字段，使用原有队伍名展示；没有匹配队伍名时才在默认名称里标出玩家。

## 验证

`tools/quest_recent_other_player_party_route.test.cjs` 覆盖实际 MsgPack 请求、无关注关系的多账号共享、超过 10 位玩家、关卡隔离、最近记录更新、重启持久化、删除级联和非法输入。

`tools/recent_quest_party_settlement.test.cjs` 覆盖单人通关、败北、退出、重复请求、改队以及晚期结算回滚；`tools/multi_remote_settlement.test.cjs` 覆盖多人成功发布、并发重复结算和回滚重试。测试使用临时数据库，服务端自动验证与客户端实机验收分开记录。
