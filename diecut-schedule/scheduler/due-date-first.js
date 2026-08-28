/** V5.1 交期优先策略：出货需求日期 > 交货日期 > 无日期。 */
function parseDate(value) { if (value === null || value === undefined || String(value).trim() === '') return null; const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d; }
function dueInfo(order) { const shipping=parseDate(order?.shipping_required_date); if(shipping) return {level:0,date:shipping,field:'shipping_required_date'}; const delivery=parseDate(order?.delivery_date || order?.delivery_time); if(delivery) return {level:1,date:delivery,field:'delivery_date'}; return {level:2,date:null,field:null}; }
function compare(a,b) { const ad=dueInfo(a), bd=dueInfo(b); if(ad.level!==bd.level) return ad.level-bd.level; if(ad.date&&bd.date&&ad.date.getTime()!==bd.date.getTime()) return ad.date-bd.date; return 0; }
module.exports={dueInfo,compare};
