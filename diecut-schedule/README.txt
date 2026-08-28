模切行业智能生产排程系统 V5.1

本版重点：交期优先修订版

排程硬优先级：
1. 出货需求日期（shipping_required_date）
2. 交货日期（delivery_date）
3. 无日期订单最后

同一出货需求日期内，再比较交货日期；之后才使用订单优先级、延期风险、换模时间、设备负荷、物料齐套等 APS 因素。

自动排程：统一使用 V5.1 交期层级。
局部重排：统一使用 V5.1 交期层级，不因设备局部重排而改变规则。
插单：POST /api/schedule/insert/:orderId，正在生产任务硬锁，其余未开工任务按同一规则重新计算。

兼容旧数据：旧 delivery_time 会作为 delivery_date 的后备字段；历史“出货日期/出货时间”导入会映射到 shipping_required_date。

数据库迁移：启动时自动增加 shipping_required_date、delivery_date 两列，不删除原 delivery_time。
