// views/settlements.js — 对账结算
/* =========================================================
   对账结算 - 收款 / 付款
   ========================================================= */
let _settleTab='receipt'; // 'receipt' | 'payment'
let _settleSubTab='unpaid'; // 'unpaid' | 'paid'
let _settleSearch='';
let _settleUnitFilter=''; // 单位筛选

/* ---- 获取符合条件的订单（签约完成/送货中/完成） ---- */
/** 获取所有符合条件的订单（签约完成/送货中/完成）
 * @returns {Array} 符合条件的订单数组
 */
function settleOrders(){
  return DB.orders.filter(function(o){
    return o.status==='签约完成'||o.status==='送货中'||o.status==='完成';
  });
}

/* ---- 收款 Tab：按采购商聚合 ---- */
/**
 * 按采购商聚合收款数据（核心聚合函数）
 * 数据流：DB.orders → 按采购商分组 → 汇总金额 → 返回聚合数组
 * 
 * 聚合逻辑：
 * 1. 遍历所有符合条件的订单（签约完成/送货中/完成）
 * 2. 按 buyerId 分组
 * 3. 每组汇总：订单数、总销售额、总采购成本、总利润、应收金额
 * 4. 查询 DB.settlements 累加已收金额（只统计收款记录）
 * 
 * 返回字段：
 * - buyerId, buyerName: 采购商ID和名称
 * - orderCount: 订单数量
 * - totalSales, totalCost, totalProfit: 金额汇总
 * - totalReceivable: 应收金额 = 销售额 - 已收
 * - totalReceived: 已收金额（从 settlements 累加）
 * - orders[]: 订单列表（用于明细展开）
 */
function settleReceiptData(){
  let orders=settleOrders();
  let buyerMap={};
  orders.forEach(function(o){
    let bid=o.buyerId;
    if(!bid)return;
    if(!buyerMap[bid]){
      buyerMap[bid]={unitId:bid,unitName:pName(bid),orders:[],totalReceivable:0,totalReceived:0};
    }
    let sales=orderSales(o);
    buyerMap[bid].orders.push(o);
    buyerMap[bid].totalReceivable+=sales;
  });
  // 汇总已收款
  (DB.settlements||[]).filter(function(s){return s.type==='receipt';}).forEach(function(s){
    let b=buyerMap[s.unitId];
    if(b)b.totalReceived+=s.amount||0;
  });
  return Object.values(buyerMap).sort(function(a,b){return b.totalReceivable-a.totalReceivable;});
}

/* ---- 付款 Tab：按供应商聚合 ---- */
/**
 * 按供应商聚合付款数据（核心聚合函数）
 * 数据流：DB.orders[].items[].options → 按供应商分组 → 汇总金额
 * 
 * 聚合逻辑：
 * 1. 遍历订单的所有产品行项目
 * 2. 提取每个产品已选供应商
 * 3. 按 supplierId 分组
 * 4. 每组汇总：订单数（去重）、采购金额、应付金额
 * 5. 查询 DB.settlements 累加已付金额（只统计付款记录）
 * 
 * 返回字段：
 * - supplierId, supplierName: 供应商ID和名称
 * - orderCount: 订单数量（去重）
 * - totalPurchase: 采购金额汇总
 * - totalPayable: 应付金额 = 采购金额 - 已付
 * - totalPaid: 已付金额（从 settlements 累加）
 * - orders[]: 订单列表（含产品明细，用于展开）
 */
function settlePaymentData(){
  let orders=settleOrders();
  let supplierMap={};
  orders.forEach(function(o){
    (o.items||[]).forEach(function(it){
      let opts=itemOpts(it);
      opts.forEach(function(op){
        let sid=op.supplierId;
        if(!sid)return;
        if(!supplierMap[sid]){
          supplierMap[sid]={unitId:sid,unitName:pName(sid),orders:[],totalPayable:0,totalPaid:0};
        }
        let cost=(op.price||0)*(op.allocQty||0);
        supplierMap[sid].totalPayable+=cost;
        if(!supplierMap[sid].orders.find(function(x){return x.id===o.id;})){
          supplierMap[sid].orders.push(o);
        }
      });
    });
  });
  // 汇总已付款
  (DB.settlements||[]).filter(function(s){return s.type==='payment';}).forEach(function(s){
    let sp=supplierMap[s.unitId];
    if(sp)sp.totalPaid+=s.amount||0;
  });
  return Object.values(supplierMap).sort(function(a,b){return b.totalPayable-a.totalPayable;});
}

/* ---- 获取某个单位关联的订单明细及其结算情况 ---- */
/** 获取指定单位的订单明细及结算金额汇总
 * @param {string} unitId - 单位ID
 * @param {string} type - 结算类型 'receipt'|'payment'
 * @returns {Array} 订单明细数组，每项含orderId/total/received/status
 */
function settleUnitOrderDetails(unitId,type){
  let orders=settleOrders();
  let result=[];
  let settlements=(DB.settlements||[]).filter(function(s){return s.type===type&&s.unitId===unitId;});

  if(type==='receipt'){
    orders.forEach(function(o){
      if(o.buyerId!==unitId)return;
      let total=orderSales(o);
      // 汇总该订单已收金额
      let received=0;
      settlements.forEach(function(s){
        (s.orders||[]).forEach(function(so){
          if(so.orderId===o.id)received+=so.amount||0;
        });
      });
      result.push({orderId:o.id,total:total,received:received,status:o.status});
    });
  }else{
    orders.forEach(function(o){
      (o.items||[]).forEach(function(it){
        let opts=itemOpts(it);
        opts.forEach(function(op){
          if(op.supplierId!==unitId)return;
          let cost=(op.price||0)*(op.allocQty||0);
          // 汇总该订单该供应商已付金额
          let paid=0;
          settlements.forEach(function(s){
            (s.orders||[]).forEach(function(so){
              if(so.orderId===o.id)paid+=so.amount||0;
            });
          });
          // 按订单聚合（供应商可能在同一个订单内有多项）
          let exist=result.find(function(r){return r.orderId===o.id;});
          if(exist){exist.total+=cost;}
          else{result.push({orderId:o.id,total:cost,received:paid,status:o.status});}
        });
      });
    });
  }
  return result;
}

/* ---- 获取单位的结算记录 ---- */
/** 获取指定单位的结算记录列表并按日期降序排列
 * @param {string} unitId - 单位ID
 * @param {string} type - 结算类型 'receipt'|'payment'
 * @returns {Array} 结算记录数组
 */
function settleRecords(unitId,type){
  return (DB.settlements||[]).filter(function(s){return s.type===type&&s.unitId===unitId;}).sort(function(a,b){
    return (b.date||'').localeCompare(a.date||'');
  });
}

/* ---- 主视图 ---- */
/** 渲染对账结算主视图（收/付款Tab、子Tab、搜索筛选、分页、统计卡片） */
/**
 * 对账结算主视图
 * 数据流：settleReceiptData()/settlePaymentData() → DOM
 * 
 * 页面结构：
 * - 统计卡：应收/应付金额、已收/已付金额、未结金额（可点击下钻）
 * - 子Tab：收款/付款切换
 * - 状态Tab：未结算/已结算筛选
 * - 单位列表表格：单位名称、订单数、金额汇总、操作
 * - 明细抽屉：展开显示订单明细、产品明细、新增结算记录
 * 
 * @param {string} type - 可选，'receipt'|'payment'，指定默认Tab
 */
function viewSettlements(type){
  if(type)_settleTab=type;
  let receiptData=settleReceiptData();
  let paymentData=settlePaymentData();
  let activeData=_settleTab==='receipt'?receiptData:paymentData;

  // 子Tab过滤（四舍五入到2位小数，与fmt显示精度对齐）
  let unpaidActiveData=activeData.filter(function(d){
    let gap=Math.round(((_settleTab==='receipt'?d.totalReceivable:d.totalPayable)-(_settleTab==='receipt'?d.totalReceived:d.totalPaid))*100)/100;
    return gap>0;
  });
  let paidActiveData=activeData.filter(function(d){
    let gap=Math.round(((_settleTab==='receipt'?d.totalReceivable:d.totalPayable)-(_settleTab==='receipt'?d.totalReceived:d.totalPaid))*100)/100;
    return gap<=0;
  });
  activeData=_settleSubTab==='unpaid'?unpaidActiveData:paidActiveData;

  // 搜索过滤
  if(_settleSearch){
    let q=_settleSearch.toLowerCase().trim();
    activeData=activeData.filter(function(d){
      if(d.unitName&&d.unitName.toLowerCase().includes(q))return true;
      return false;
    });
  }
  // 单位筛选
  if(_settleUnitFilter){
    activeData=activeData.filter(function(d){return d.unitId===_settleUnitFilter;});
  }

  // 分页
  let totalPages=Math.max(1,Math.ceil(activeData.length/PAGE_SIZE));
  if(_settlePage>totalPages)_settlePage=totalPages;
  let pageData=activeData.slice((_settlePage-1)*PAGE_SIZE,_settlePage*PAGE_SIZE);

  // 当前Tab统计
  let tabAllData=_settleTab==='receipt'?receiptData:paymentData;
  let tabTotal=0,tabDone=0;
  tabAllData.forEach(function(d){
    tabTotal+=(_settleTab==='receipt'?d.totalReceivable:d.totalPayable);
    tabDone+=(_settleTab==='receipt'?d.totalReceived:d.totalPaid);
  });

  // 子Tab标签
  let subUnpaidLabel=_settleTab==='receipt'?'未收（'+unpaidActiveData.length+'家）':'未付（'+unpaidActiveData.length+'家）';
  let subPaidLabel=_settleTab==='receipt'?'已收（'+paidActiveData.length+'家）':'已付（'+paidActiveData.length+'家）';

  // 列表行
  let rows=pageData.map(function(d){
    let gap=(_settleTab==='receipt'?d.totalReceivable:d.totalPayable)-(_settleTab==='receipt'?d.totalReceived:d.totalPaid);
    let pct=(_settleTab==='receipt'?d.totalReceivable:d.totalPayable)>0?
      Math.round((_settleTab==='receipt'?d.totalReceived:d.totalPaid)/(_settleTab==='receipt'?d.totalReceivable:d.totalPayable)*100):0;
    let statusTag=pct>=100?'<span class="tag ok">已结清</span>':
      (pct>0?'<span class="tag info">部分结算</span>':'<span class="tag err">未结算</span>');
    return '<tr>'+
      '<td><b>'+escHtml(d.unitName)+'</b></td>'+
      '<td style="font-weight:600">'+fmt(_settleTab==='receipt'?d.totalReceivable:d.totalPayable)+'</td>'+
      '<td style="color:var(--green);font-weight:600">'+fmt(_settleTab==='receipt'?d.totalReceived:d.totalPaid)+'</td>'+
      '<td style="color:'+(gap>0?'var(--red)':'var(--gray)')+'">'+fmt(gap)+'</td>'+
      '<td>'+statusTag+'<div class="settle-progress-bar"><div class="settle-progress-fill" style="width:'+pct+'%;background:'+(pct>=100?'var(--green)':pct>0?'var(--pri)':'var(--red)')+'"></div></div></td>'+
      '<td class="td-act">'+
        '<button class="btn xs" onclick="openSettleDetail(\''+d.unitId+'\',\''+type+'\')">'+icon('fileText')+'明细</button>'+
        '<button class="btn xs primary" onclick="openNewSettlement(\''+d.unitId+'\',\''+type+'\')">'+icon('plus')+'新增结算</button>'+
      '</td>'+
    '</tr>';
  }).join('');

  let pg=totalPages>1?buildPaging(activeData.length,_settlePage,totalPages,'settlePage',{id:'settlePaging'}):'';
  let tabSearchLabel=_settleTab==='receipt'?'收款':'付款';

  return '<div class="toolbar">'+
    '<div class="search-box' + (_settleSearch ? ' has-val' : '') + '" style="max-width:220px">'+
      '<a href="javascript:void(0)" data-search-fn="onSettleSearch" onclick="onSettleSearch(document.getElementById(\'settleSearchInput\').value)" style="text-decoration:none;color:inherit;cursor:pointer;display:flex;align-items:center">'+icon('search','16')+'</a>'+
      '<input id="settleSearchInput" type="text" aria-label="搜索单位名称" tabindex="1" value="'+escAttr(_settleSearch)+'" placeholder="搜索单位名称..." onkeydown="if(event.key===\'Enter\')onSettleSearch(this.value)">'+
      '<span class="clear-btn" onclick="onSettleSearch(\'\')">×</span>'+
    '</div>'+
    '<div class="spacer"></div>'+
    '<button class="btn primary" onclick="openNewSettlement(\'\',\''+type+'\')">'+icon('plus')+'新增结算记录</button>'+
  '</div>'+
  // 统计卡片（按当前主Tab）
  '<div class="stats" style="grid-template-columns:repeat(3,1fr)">'+
    '<div class="stat"><div class="k">'+(_settleTab==='receipt'?'应收总额':'应付总额')+'</div><div class="v">'+fmt(tabTotal)+'</div></div>'+
    '<div class="stat stat-click" onclick="drillSettleTab(\'paid\')" role="button" tabindex="0"><div class="k">'+(_settleTab==='receipt'?'已收总额':'已付总额')+'</div><div class="v" style="color:var(--green)">'+fmt(tabDone)+'</div></div>'+
    '<div class="stat stat-click" onclick="drillSettleTab(\'unpaid\')" role="button" tabindex="0"><div class="k">'+(_settleTab==='receipt'?'未收总额':'未付总额')+'</div><div class="v" style="color:'+(tabTotal-tabDone>0?'var(--red)':'var(--gray)')+'">'+fmt(tabTotal-tabDone)+'</div></div>'+
  '</div>'+
  // 子Tabs（已升级为唯一Tabs）
  '<div class="settle-tabs" style="display:flex;border-bottom:2px solid var(--line);margin-bottom:16px">'+
    '<button class="settle-tab ' + (_settleSubTab === 'unpaid' ? 'active' : '') + '" onclick="switchSettleSubTab(\'unpaid\')"><span>'+subUnpaidLabel+'</span></button>'+
    '<button class="settle-tab ' + (_settleSubTab === 'paid' ? 'active' : '') + '" onclick="switchSettleSubTab(\'paid\')"><span>'+subPaidLabel+'</span></button>'+
  '</div>'+
  // 表格
  '<div class="card"><div class="table-wrap"><table><thead><tr>'+
    '<th>' + (_settleTab === 'receipt' ? '采购商' : '供应商') + '</th>'+
    '<th>' + (_settleTab === 'receipt' ? '应收款' : '应付款') + '</th>'+
    '<th>' + (_settleTab === 'receipt' ? '实收款' : '实付款') + '</th>'+
    '<th>' + (_settleTab === 'receipt' ? '未收款' : '未付款') + '</th>'+
    '<th>结算状态</th>'+
    '<th>操作</th>'+
  '</tr></thead><tbody>'+
    (rows || '<tr><td colspan="6"><div class="no-data">' + (_settleSearch?'未找到匹配"'+escHtml(_settleSearch)+'"的'+tabSearchLabel+'记录':(_settleTab==='receipt'?'暂无收款记录，点击「新建结算」开始':'暂无付款记录，点击「新建结算」开始')) + '</div></td></tr>')+
  '</tbody></table></div>' + pg + '</div>';
}

/* ---- 统计卡下钻 ---- */
/** 统计卡点击下钻到已收/未收子Tab并滚动到表格区域
 * @param {string} sub - 子Tab类型 'unpaid'|'paid'
 * @returns {void}
 */
function drillSettleTab(sub){
  _settleSubTab=sub;_settlePage=1;
  render();
  // 滚动到表格区域
  requestAnimationFrame(function(){
    requestAnimationFrame(function(){
      let el=document.querySelector('.card table');
      if(el)el.scrollIntoView({behavior:'smooth',block:'start'});
    });
  });
}

/* ---- 切换子Tab ---- */
/** 切换已收/未收子Tab并重新渲染
 * @param {string} sub - 子Tab类型 'unpaid'|'paid'
 * @returns {void}
 */
function switchSettleSubTab(sub){
  _settleSubTab=sub;_settlePage=1;
  render();
}

/* ---- 单位下拉筛选 ---- */
/** 设置单位筛选条件并重新渲染
 * @param {string} val - 单位ID，空字符串表示清空筛选
 * @returns {void}
 */
function onSettleUnitFilter(val){
  _settleUnitFilter=val||'';
  _settlePage=1;
  render();
}

/* ---- 搜索 ---- */
/** 设置搜索关键词并重新渲染（含搜索框高亮切换）
 * @param {string} v - 搜索关键词
 * @returns {void}
 */
function onSettleSearch(v){
  _settleSearch=v;_settlePage=1;
  let box=document.querySelector('.search-box');
  if(box){if(v)box.classList.add('has-val');else box.classList.remove('has-val');}
  render();
}

/* ---- 分页 ---- */
/** 对账结算分页跳转
 * @param {number} n - 目标页码
 * @returns {void}
 */
function settlePage(n){
  let activeData=_settleTab==='receipt'?settleReceiptData():settlePaymentData();

  // 子Tab过滤（四舍五入到2位小数，与fmt显示精度对齐）
  let unpaidActiveData=activeData.filter(function(d){
    let gap=Math.round(((_settleTab==='receipt'?d.totalReceivable:d.totalPayable)-(_settleTab==='receipt'?d.totalReceived:d.totalPaid))*100)/100;
    return gap>0;
  });
  let paidActiveData=activeData.filter(function(d){
    let gap=Math.round(((_settleTab==='receipt'?d.totalReceivable:d.totalPayable)-(_settleTab==='receipt'?d.totalReceived:d.totalPaid))*100)/100;
    return gap<=0;
  });
  activeData=_settleSubTab==='unpaid'?unpaidActiveData:paidActiveData;

  if(_settleSearch){
    let q=_settleSearch.toLowerCase().trim();
    activeData=activeData.filter(function(d){return d.unitName&&d.unitName.toLowerCase().includes(q);});
  }
  if(_settleUnitFilter){
    activeData=activeData.filter(function(d){return d.unitId===_settleUnitFilter;});
  }
  let total=Math.ceil(activeData.length/PAGE_SIZE)||1;
  _settlePage=Math.max(1,Math.min(n,total));
  render();
}

/* ---- 产品明细行（收款/付款明细抽屉） ---- */
/** 获取指定单位关联订单的产品明细行（按SKU+规格展开）
 * @param {string} unitId - 单位ID
 * @param {string} type - 结算类型 'receipt'|'payment'
 * @returns {Array} 产品明细数组，每项含orderId/sku/spec/price/qty/total
 */
function settleProductRows(unitId,type){
  let orders=settleOrders();
  let rows=[];
  if(type==='receipt'){
    orders.forEach(function(o){
      if(o.buyerId!==unitId)return;
      (o.items||[]).forEach(function(it){
        rows.push({orderId:o.id,sku:it.sku||it.name||'-',spec:it.spec||it.diameter||'',attrs:it,price:itemQuotePrice(it),qty:it.qty,total:itemQuotePrice(it)*it.qty});
      });
    });
  }else{
    orders.forEach(function(o){
      (o.items||[]).forEach(function(it){
        itemOpts(it).forEach(function(op){
          if(op.supplierId!==unitId)return;
          rows.push({orderId:o.id,sku:it.sku||it.name||'-',spec:it.spec||it.diameter||'',attrs:it,price:op.price||0,qty:op.allocQty||0,total:(op.price||0)*(op.allocQty||0)});
        });
      });
    });
  }
  return rows;
}

/* ---- 单位结算明细抽屉 ---- */
/** 打开单位结算明细抽屉（关联订单+产品明细+结算记录三区块折叠）
 * @param {string} unitId - 单位ID
 * @param {string} tabType - Tab类型 'receipt'|'payment'
 * @returns {void}
 */
function openSettleDetail(unitId, tabType){
  let records=settleRecords(unitId, tabType);
  let orderDetails=settleUnitOrderDetails(unitId, tabType);
  let unitName=pName(unitId);
  let total=0,settled=0;
  orderDetails.forEach(function(d){total+=d.total;settled+=d.received;});

  let orderRows=orderDetails.map(function(d){
    let remain=d.total-d.received;
    let st=remain<=0?'<span class="tag ok">已结清</span>':(d.received>0?'<span class="tag info">部分</span>':'<span class="tag warn">未结算</span>');
    return '<tr>'+
      '<td><b>'+escHtml(d.orderId)+'</b></td>'+
      '<td><span class="tag '+STATUS_COLORS[d.status]+'">'+escHtml(d.status)+'</span></td>'+
      '<td>'+fmt(d.total)+'</td>'+
      '<td style="color:var(--green)">'+fmt(d.received)+'</td>'+
      '<td style="color:'+(remain>0?'var(--red)':'var(--gray)')+'">'+fmt(remain)+'</td>'+
      '<td>'+st+'</td>'+
    '</tr>';
  }).join('');

  let recordRows=records.map(function(r){
    let orderIds=(r.orders||[]).map(function(o){return o.orderId;}).join('、');
    return '<tr>'+
      '<td>'+escHtml(r.date||'')+'</td>'+
      '<td>'+fmt(r.amount)+'</td>'+
      '<td>'+escHtml(r.person||'-')+'</td>'+
      '<td style="font-size:13px">'+escHtml(orderIds||'-')+'</td>'+
      '<td>'+escHtml(r.note||'')+'</td>'+
    '</tr>';
  }).join('');

  // 产品明细（按订单分组，同订单号合并单元格）
  let productRows=settleProductRows(unitId, tabType);
  let productHTML='';
  if(productRows.length){
    // 预计算每个订单的产品行数
    let groupCount={};
    productRows.forEach(function(p){groupCount[p.orderId]=(groupCount[p.orderId]||0)+1;});
    let orderSeen={};
    productRows.forEach(function(p){
      let rowspan='';
      if(!orderSeen[p.orderId]){
        orderSeen[p.orderId]=true;
        rowspan=' rowspan="'+groupCount[p.orderId]+'"';
      }
      productHTML+='<tr>'+
        (rowspan?'<td'+rowspan+'><b>'+escHtml(p.orderId)+'</b></td>':'')+
        '<td>'+escHtml(p.sku)+'</td>'+
        '<td style="font-size:13px">'+escHtml(p.spec)+'</td>'+
        '<td>'+specTags(p.attrs)+'</td>'+
        '<td>'+fmt(p.price)+'</td>'+
        '<td>'+fmtN(p.qty)+'</td>'+
        '<td style="font-weight:600">'+fmt(p.total)+'</td>'+
      '</tr>';
    });
  }

  let isReceipt=tabType==='receipt';
  let body='<div style="background:var(--bg-tint);border:1px solid var(--line);border-radius:8px;padding:16px;margin-bottom:16px">'+
    '<div style="font-size:16px;font-weight:700;margin-bottom:8px">'+escHtml(unitName)+'</div>'+
    '<div style="display:flex;gap:32px;font-size:14px">'+
      '<div><span class="muted">'+(isReceipt?'应收总额':'应付总额')+'</span> <b>'+fmt(total)+'</b></div>'+
      '<div><span class="muted">'+(isReceipt?'已收金额':'已付金额')+'</span> <b style="color:var(--green)">'+fmt(settled)+'</b></div>'+
      '<div><span class="muted">'+(isReceipt?'未收金额':'未付金额')+'</span> <b style="color:'+(total>settled?'var(--red)':'var(--gray)')+'">'+fmt(total-settled)+'</b></div>'+
    '</div>'+
  '</div>'+

  '<div class="drawer-section">'+
    '<div class="drawer-section-hd" onclick="toggleDrawerSection(this)" style="cursor:pointer">'+icon('fileText','14')+' 关联订单 <span class="tag gray" style="margin-left:6px">'+orderDetails.length+'</span><span class="sec-arrow">'+icon('chevronUp','12')+'</span></div>'+
    '<div class="drawer-section-body"><div class="table-wrap" style="margin-bottom:0"><table><thead><tr><th>订单号</th><th>状态</th><th>'+(isReceipt?'应收':'应付')+'</th><th>'+(isReceipt?'已收':'已付')+'</th><th>'+(isReceipt?'未收':'未付')+'</th><th>结算状态</th></tr></thead><tbody>'+
    (orderRows||'<tr><td colspan="6"><div class="no-data">无关联订单</div></td></tr>')+
  '</tbody></table></div></div></div>'+

  '<div class="drawer-section">'+
    '<div class="drawer-section-hd" onclick="toggleDrawerSection(this)" style="cursor:pointer">'+icon('package','14')+' 产品明细 <span class="tag gray" style="margin-left:6px">'+productRows.length+'</span><span class="sec-arrow">'+icon('chevronUp','12')+'</span></div>'+
    '<div class="drawer-section-body"><div class="table-wrap" style="margin-bottom:0"><table><thead><tr><th>订单号</th><th>SKU</th><th>规格</th><th>属性</th><th>单价</th><th>数量</th><th>总额</th></tr></thead><tbody>'+
    (productHTML||'<tr><td colspan="7"><div class="no-data">暂无产品数据</div></td></tr>')+
  '</tbody></table></div></div></div>'+

  '<div class="drawer-section" style="margin-bottom:0">'+
    '<div class="drawer-section-hd" onclick="toggleDrawerSection(this)" style="cursor:pointer">'+icon('wallet','14')+' 结算记录 <span class="tag gray" style="margin-left:6px">'+records.length+'</span><span class="sec-arrow">'+icon('chevronUp','12')+'</span></div>'+
    '<div class="drawer-section-body"><div class="table-wrap" style="margin-bottom:0"><table><thead><tr><th>日期</th><th>金额</th><th>'+
    (isReceipt?'付款人':'收款人')+
    '</th><th>关联订单</th><th>备注</th></tr></thead><tbody>'+
    (recordRows||'<tr><td colspan="5"><div class="no-data">暂无结算记录</div></td></tr>')+
  '</tbody></table></div></div>';

  openDrawer((tabType==='receipt'?'收款':'付款')+'明细 · '+escHtml(unitName),body,null,true,true);
}

/* ---- 删除结算记录 ---- */
/** 删除指定结算记录（含发票关联检查提示）
 * @param {string} id - 结算记录ID
 * @returns {void}
 */
function delSettlement(id){
  let invRefs=(DB.invoices||[]).filter(function(inv){return inv.settleId===id;});
  let warnMsg='';
  if(invRefs.length>0){
    warnMsg='⚠ 该结算记录已生成 '+invRefs.length+' 条发票记录（发票号 '+invRefs.map(function(inv){return escHtml(inv.invoiceNo||inv.id);}).join('、')+'），删除后发票数据会失配，是否仍继续？\n\n';
  }
  confirmModal(warnMsg+'确认删除该结算记录？（删除后进入回收站，可恢复）',function(){
    softDelete('settlement',id,{operator:'user'});
    render();
    toast('结算记录已删除','info');
  },'确认删除');
}

/* ---- 新增结算记录 ---- */
/** 打开新增结算记录抽屉（含单位/订单多选和金额自动汇总）
 * @param {string} presetUnitId - 预设单位ID（可选）
 * @param {string} type - 结算类型 'receipt'|'payment'（可选）
 * @returns {void}
 */
function openNewSettlement(presetUnitId,type){
  // 默认使用当前 tab
  let tabType=type||_settleTab;

  // 获取候选订单
  let orders=settleOrders();
  // 如果预设了 unitId，筛选相关订单
  let candidateOrders=[];
  if(presetUnitId){
    if(tabType==='receipt'){
      candidateOrders=orders.filter(function(o){return o.buyerId===presetUnitId;});
    }else{
      orders.forEach(function(o){
        let hasSupplier=(o.items||[]).some(function(it){
          return itemOpts(it).some(function(op){return op.supplierId===presetUnitId;});
        });
        if(hasSupplier)candidateOrders.push(o);
      });
    }
  }

  let orderOptsHTML='';
  if(candidateOrders.length){
    orderOptsHTML=candidateOrders.map(function(o){
      let amount=0;
      if(tabType==='receipt'){
        amount=orderSales(o);
        // 减去已收金额
        let received=0;
        (DB.settlements||[]).filter(function(s){return s.type==='receipt'&&s.unitId===presetUnitId;}).forEach(function(s){
          (s.orders||[]).forEach(function(so){if(so.orderId===o.id)received+=so.amount||0;});
        });
        amount-=received;
      }else{
        (o.items||[]).forEach(function(it){
          itemOpts(it).forEach(function(op){
            if(op.supplierId===presetUnitId)amount+=(op.price||0)*(op.allocQty||0);
          });
        });
        let paid=0;
        (DB.settlements||[]).filter(function(s){return s.type==='payment'&&s.unitId===presetUnitId;}).forEach(function(s){
          (s.orders||[]).forEach(function(so){if(so.orderId===o.id)paid+=so.amount||0;});
        });
        amount-=paid;
      }
      if(amount<=0)return'';
      return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0">'+
        '<input type="checkbox" class="settle-order-chk" value="'+o.id+'" data-max="'+amount+'" style="width:16px;height:16px;cursor:pointer;accent-color:var(--green)">'+
        '<span>'+escHtml(o.id)+'</span>'+
        '<span class="tag '+STATUS_COLORS[o.status]+'">'+escHtml(o.status)+'</span>'+
        '<span style="margin-left:auto">未结: <b>'+fmt(amount)+'</b></span>'+
      '</div>';
    }).join('');
  }else if(presetUnitId){
    orderOptsHTML='<div class="muted" style="padding:10px 0">该单位暂无待结算订单（所有订单已结清）</div>';
  }

  let body=
    '<div class="field" style="margin-bottom:10px">'+
      '<label class="f">结算类型</label>'+
      '<select id="st_type" onchange="onSettleTypeChange()" tabindex="10">'+
        '<option value="receipt" '+(tabType==='receipt'?'selected':'')+'>收款（向采购商收）</option>'+
        '<option value="payment" '+(tabType==='payment'?'selected':'')+'>付款（付给供应商）</option>'+
      '</select>'+
    '</div>'+
    '<div class="field" style="margin-bottom:10px">'+
      '<label class="f">'+(tabType==='receipt'?'采购商':'供应商')+' <span style="color:var(--red)">*</span></label>'+
      '<div id="st_unit" class="combo" data-placeholder="搜索选择单位..." data-val="'+escAttr(presetUnitId||'')+'"></div>'+
    '</div>'+
    '<div class="grid2" style="gap:12px">'+
      '<div class="field" style="margin:0"><label class="f">结算日期 <span style="color:var(--red)">*</span></label><input id="st_date" type="date" tabindex="11" value="'+today()+'"></div>'+
      '<div class="field" style="margin:0"><label class="f">结算金额(元) <span style="color:var(--red)">*</span></label><input id="st_amount" type="number" step="0.01" tabindex="12" placeholder="0.00"></div>'+
    '</div>'+
    '<div class="grid2" style="gap:12px;margin-top:14px">'+
      '<div class="field" style="margin:0"><label class="f">'+((tabType==='receipt'?'付款人':'收款人'))+'</label><input id="st_person" tabindex="13" placeholder="'+((tabType==='receipt'?'付款人姓名':'收款人姓名'))+'"></div>'+
      '<div class="field" style="margin:0"><label class="f">备注</label><input id="st_note" tabindex="14" placeholder="备注信息"></div>'+
    '</div>'+
    '<div id="st_orderSection" style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line)">'+
      '<label class="f">关联结算订单（可多选）</label>'+
      '<div id="st_orderList" style="max-height:260px;overflow-y:auto;border:1px solid var(--line);border-radius:6px;padding:8px 12px;background:var(--card)">'+
        (orderOptsHTML||'<div class="muted" style="padding:10px 0">请先选择单位，然后勾选订单</div>')+
      '</div>'+
      '<div style="margin-top:6px;font-size:12px;color:var(--gray)">勾选订单后将自动汇总未结金额填充到结算金额</div>'+
    '</div>';

  openDrawer('新增结算记录',body,function(){submitSettlement();},true,false);

  // 绑定单位下拉
  setTimeout(function(){
    let isReceipt=document.getElementById('st_type').value==='receipt';
    let roleLabel=isReceipt?'采购商':'供应商';
    let unitOpts=DB.units.filter(function(u){return u.roles.includes(roleLabel);}).map(function(u){
      return {id:u.id,label:u.name,tag:{text:u.rating,cls:u.rating==='主力'?'ok':(u.rating==='新客'?'warn':'gray')}};
    });
    let unitEl=document.getElementById('st_unit');
    if(unitEl){
      combo(unitEl,unitOpts,function(opt){
        unitEl.dataset.val=opt.id;
        refreshSettleOrderList();
      },'搜索选择单位...',true);
    }

    // 绑定订单列表变化时自动汇总金额
    let ol=document.getElementById('st_orderList');
    if(ol){
      ol.addEventListener('change',function(e){
        if(e.target.classList.contains('settle-order-chk')){
          autoSumSettleAmount();
        }
      });
    }
  },100);
}

/* ---- 切换结算类型 ---- */
/** 切换结算类型（收款/付款）时重新绑定单位下拉并清空金额
 * @returns {void}
 */
function onSettleTypeChange(){
  let oldPerson=document.getElementById('st_person').value;
  let oldAmount=document.getElementById('st_amount').value;
  let shouldClearToast=(oldPerson&&oldPerson.trim())||(oldAmount&&oldAmount.trim());
  document.getElementById('st_person').value='';
  document.getElementById('st_amount').value='';
  document.getElementById('st_note').value='';
  if(shouldClearToast){toast('结算类型已切换，经手人/金额/备注已清空','info');}

  let type=document.getElementById('st_type').value;
  let unitEl=document.getElementById('st_unit');
  let personLabel=type==='receipt'?'付款人':'收款人';
  let personEl=document.getElementById('st_person');
  if(personEl)personEl.placeholder='经手人姓名';

  // 重新绑定单位下拉（保留当前单位，仅过滤角色）
  let roleLabel=type==='receipt'?'采购商':'供应商';
  let currentUnitId=unitEl?unitEl.dataset.val:'';
  // 如果当前单位符合新角色则保留，否则清空
  if(currentUnitId){
    let curUnit=DB.units.find(function(u){return u.id===currentUnitId;});
    if(!curUnit||!curUnit.roles.includes(roleLabel)){
      currentUnitId='';
    }
  }
  let unitOpts=DB.units.filter(function(u){return u.roles.includes(roleLabel);}).map(function(u){
    return {id:u.id,label:u.name,tag:{text:u.rating,cls:u.rating==='主力'?'ok':(u.rating==='新客'?'warn':'gray')}};
  });
  if(unitEl){
    unitEl.innerHTML='';
    combo(unitEl,unitOpts,function(opt){
      unitEl.dataset.val=opt.id;
      refreshSettleOrderList();
    },'搜索选择单位...',true);
    if(currentUnitId){
      let selUnit=DB.units.find(function(u){return u.id===currentUnitId;});
      if(selUnit){
        unitEl.dataset.val=currentUnitId;
        let inp=unitEl.querySelector('input');
        if(inp)inp.value=selUnit.name;
        refreshSettleOrderList();
      }
    }
  }
  let ol=document.getElementById('st_orderList');
  if(ol)ol.innerHTML='<div class="muted" style="padding:10px 0">请先选择单位，然后勾选订单</div>';
}

/* ---- 刷新订单列表 ---- */
/** 根据所选单位和结算类型刷新待结算订单勾选列表
 * @returns {void}
 */
function refreshSettleOrderList(){
  let unitId=document.getElementById('st_unit').dataset.val;
  let type=document.getElementById('st_type').value;
  let ol=document.getElementById('st_orderList');
  if(!ol||!unitId)return;

  let orders=settleOrders();
  let candidateOrders=[];
  if(type==='receipt'){
    candidateOrders=orders.filter(function(o){return o.buyerId===unitId;});
  }else{
    orders.forEach(function(o){
      let hasSupplier=(o.items||[]).some(function(it){
        return itemOpts(it).some(function(op){return op.supplierId===unitId;});
      });
      if(hasSupplier)candidateOrders.push(o);
    });
  }

  let orderOptsHTML='';
  if(candidateOrders.length){
    orderOptsHTML=candidateOrders.map(function(o){
      let amount=0;
      if(type==='receipt'){
        amount=orderSales(o);
        let received=0;
        (DB.settlements||[]).filter(function(s){return s.type==='receipt'&&s.unitId===unitId;}).forEach(function(s){
          (s.orders||[]).forEach(function(so){if(so.orderId===o.id)received+=so.amount||0;});
        });
        amount-=received;
      }else{
        (o.items||[]).forEach(function(it){
          itemOpts(it).forEach(function(op){
            if(op.supplierId===unitId)amount+=(op.price||0)*(op.allocQty||0);
          });
        });
        let paid=0;
        (DB.settlements||[]).filter(function(s){return s.type==='payment'&&s.unitId===unitId;}).forEach(function(s){
          (s.orders||[]).forEach(function(so){if(so.orderId===o.id)paid+=so.amount||0;});
        });
        amount-=paid;
      }
      if(amount<=0)return'';
      return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0">'+
        '<input type="checkbox" class="settle-order-chk" value="'+o.id+'" data-max="'+amount+'" style="width:16px;height:16px;cursor:pointer;accent-color:var(--green)">'+
        '<span>'+escHtml(o.id)+'</span>'+
        '<span class="tag '+STATUS_COLORS[o.status]+'">'+escHtml(o.status)+'</span>'+
        '<span style="margin-left:auto">未结: <b>'+fmt(amount)+'</b></span>'+
      '</div>';
    }).join('');
  }

  ol.innerHTML=orderOptsHTML||'<div class="muted" style="padding:10px 0">该单位暂无待结算订单（所有订单已结清）</div>';

  // 重新绑定change事件
  ol.addEventListener('change',function(e){
    if(e.target.classList.contains('settle-order-chk')){
      autoSumSettleAmount();
    }
  });
}

/* ---- 自动汇总勾选订单的未结金额 ---- */
/** 自动汇总勾选订单的未结金额填充到结算金额输入框
 * @returns {void}
 */
function autoSumSettleAmount(){
  let chks=document.querySelectorAll('.settle-order-chk:checked');
  let sum=0;
  chks.forEach(function(c){sum+=parseFloat(c.dataset.max||0);});
  let amtEl=document.getElementById('st_amount');
  if(amtEl){
    amtEl.value=sum.toFixed(2);
    amtEl.classList.add('settle-amount-filled');
    amtEl.addEventListener('transitionend',function(){
      amtEl.classList.remove('settle-amount-filled');
    },{once:true});
    toast('已自动填入结算金额：'+sum.toFixed(2)+' 元','success');
  }
}

/* ---- 提交结算 ---- */
/** 校验并提交结算记录（含金额分配和二次确认）
 * @returns {void}
 */
function submitSettlement(){
  let type=document.getElementById('st_type').value;
  let unitId=document.getElementById('st_unit').dataset.val;
  let date=document.getElementById('st_date').value;
  let amount=+document.getElementById('st_amount').value;
  let person=document.getElementById('st_person').value.trim();
  let note=document.getElementById('st_note').value.trim();

  if(!unitId){toast('请选择单位','warning');return;}
  if(!date){toast('请选择结算日期','warning');return;}
  if(!(amount>0)){toast('请输入有效结算金额','warning');return;}

  let chks=document.querySelectorAll('.settle-order-chk:checked');
  let orderEntries=[];
  let totalMax=0;
  chks.forEach(function(c){totalMax+=parseFloat(c.dataset.max||0);});

  if(chks.length>0&&Math.round(amount*100)>Math.round(totalMax*100)){
    toast('结算金额 '+fmt(amount)+' 大于勾选订单未结总额 '+fmt(totalMax)+'，请核对','error');
    return;
  }

  if(totalMax>0){
    let allocated=0;
    let tmp=[];
    chks.forEach(function(c){
      let maxAmt=parseFloat(c.dataset.max||0);
      let prorated=Math.round(amount*maxAmt/totalMax*100)/100;
      tmp.push({orderId:c.value,amount:prorated});
      allocated+=prorated;
    });
    let diff=Math.round((amount-allocated)*100)/100;
    if(diff!==0) tmp[tmp.length-1].amount=Math.round((tmp[tmp.length-1].amount+diff)*100)/100;
    orderEntries=tmp;
  }

  if(chks.length>0&&!orderEntries.length){toast('请至少勾选一个关联订单','warning');return;}

  // 组装确认信息
  let unitName=(DB.units.find(function(u){return u.id===unitId;})||{}).name||unitId;
  let typeLabel=type==='receipt'?'收款':'付款';
  let orderLines=orderEntries.map(function(e){return e.orderId+' <span style="color:var(--gray)">分配</span> '+fmt(e.amount);}).join('<br>');
  let confirmHTML=
    '<table class="info-table"><tbody>'+
    '<tr><td class="l">类型</td><td><b>'+typeLabel+'</b></td></tr>'+
    '<tr><td class="l">单位</td><td>'+escHtml(unitName)+'</td></tr>'+
    '<tr><td class="l">日期</td><td>'+escHtml(date)+'</td></tr>'+
    '<tr><td class="l">金额</td><td><b class="amount">'+fmt(amount)+'</b></td></tr>'+
    (person?'<tr><td class="l">经手人</td><td>'+escHtml(person)+'</td></tr>':'')+
    (note?'<tr><td class="l">备注</td><td>'+escHtml(note)+'</td></tr>':'')+
    '<tr><td class="l">关联订单</td><td>'+orderLines+'</td></tr>'+
    '</tbody></table>';

  confirmModal(confirmHTML,function(){
    DB.settlements=DB.settlements||[];
    DB.settlements.push({
      id:uid('ST'),
      type:type,
      unitId:unitId,
      date:date,
      amount:amount,
      person:person,
      note:note,
      orders:orderEntries,
      createdAt:now()
    });
    saveDB();
    closeDrawer();
    render();
    toast('结算记录已保存','success');
  },'确认保存','取消');
}

/* ---- 抽屉区块折叠 ---- */
/** 切换抽屉内折叠区块的展开/收起状态
 * @param {HTMLElement} hd - 折叠区块的头部元素
 * @returns {void}
 */
function toggleDrawerSection(hd){
  const body=hd.nextElementSibling;
  const arrow=hd.querySelector('.sec-arrow');
  if(!body) return;
  const isCollapsed=body.style.display==='none';
  body.style.display=isCollapsed?'':'none';
  if(arrow){
    if(isCollapsed){arrow.classList.remove('collapsed');}
    else{arrow.classList.add('collapsed');}
  }
}
