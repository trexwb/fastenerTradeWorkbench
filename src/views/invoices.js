// views/invoices.js — 发票管理
/* =========================================================
   发票管理 - 开票 / 收票
   ========================================================= */
let _invTab='issue'; // 'issue' | 'receive'
let _invSubTab='unpaid'; // 'unpaid' | 'paid'（未开/未收 vs 已开/已收）
let _invSearch='';
let _invUnitFilter=''; // 单位筛选
let _invPage=1;
let _invStatusFilter=''; // 开票/收票状态筛选
/** 发票编辑保存防重锁 */
let _invEditSaving=false;

const INV_ISSUE_STATUS=['未开票','已开票'];
const INV_RECEIVE_STATUS=['未收票','已收票'];

/* ---- 从结算记录同步生成发票记录（去重：同一settleId只生成一次） ---- */
/**
 * 从结算记录同步生成发票记录（数据同步函数）
 * 数据流：DB.settlements → DB.invoices（去重合并）
 * 
 * 同步逻辑：
 * 1. 遍历 DB.settlements 所有结算记录
 * 2. 按 settleId 查找是否已存在发票记录
 * 3. 不存在则创建新记录，存在则更新金额和备注
 * 4. 自动生成备注：从关联订单提取 SKU/单价/数量
 * 5. 根据结算类型（收款/付款）设置发票类型（开票/收票）
 * 
 * 字段说明：
 * - settleId: 关联结算记录ID
 * - unitId/unitName: 单位ID和名称
 * - amount: 金额
 * - type: 'issue'(开票) | 'receive'(收票)
 * - invoiceStatus: 开票状态（未开票/已开票）
 * - receiveStatus: 收票状态（未收票/已收票）
 * - records[]: 发票明细记录（可拆分多张发票）
 * 
 * @returns {boolean} 是否有数据变更
 */
function syncInvoices(){
  DB.invoices=DB.invoices||[];
  let lookup={};
  DB.invoices.forEach(function(inv){lookup[inv.settleId]=inv;});
  let changed=false;

  (DB.settlements||[]).forEach(function(s){
    let inv=lookup[s.id]||null;
    let isNew=!inv;

    let unitName=(DB.units.find(function(u){return u.id===s.unitId;})||{}).name||s.unitId;

    // 生成备注：从关联订单中提取 SKU/单价/数量
    let remarkParts=[];
    let settleOrders=DB.orders.filter(function(o){return o.status==='签约完成'||o.status==='送货中'||o.status==='完成';});
    (s.orders||[]).forEach(function(so){
      let ord=settleOrders.find(function(o){return o.id===so.orderId;});
      if(!ord)return;
      (ord.items||[]).forEach(function(it){
        if(s.type==='receipt'){
          remarkParts.push({sku:it.sku||it.name||'-',price:itemQuotePrice(it),qty:it.qty||0});
        }else{
          let opts=itemOpts(it);
          opts.forEach(function(op){
            if(op.supplierId===s.unitId){
              remarkParts.push({sku:it.sku||it.name||'-',price:op.price||0,qty:op.allocQty||0});
            }
          });
        }
      });
    });
    let remark;
    if(remarkParts.length===0 && s.orders && s.orders.length===0){
      remark=(s.note?s.note+'\n':'')+'（独立结算单：无关联订单，金额 '+fmt(s.amount)+'）';
    }else{
      remark=(s.note?s.note+'\n':'')+(remarkParts.map(function(r){return r.sku+'×'+r.qty+'×'+r.price;}).join('；')||'无明细');
    }

    // 应收/应付使用 settlement 本身的金额，避免同订单多次结算时重复计算
    let receivable=(s.type==='receipt')?(s.amount||0):0;
    let payable=(s.type==='payment')?(s.amount||0):0;

    if(isNew){
      inv={
        id:uid('INV'),
        settleId:s.id,
        type:s.type==='receipt'?'issue':'receive',
        unitId:s.unitId,
        unitName:unitName,
        amount:s.amount||0,
        receivable:receivable,
        payable:payable,
        remark:remark,
        settleNote:s.note||'',
        settleDate:s.date||'',

        invoiceNumber:'',
        invoiceStatus:s.type==='receipt'?'未开票':'',
        taxTitle:'',
        receiveStatus:s.type==='payment'?'未收票':'',
        createdAt:now()
      };
      DB.invoices.push(inv);
    }else{
      inv.unitName=unitName;
      inv.amount=s.amount||0;
      inv.receivable=receivable;
      inv.payable=payable;
      inv.remark=remark;
      inv.settleNote=s.note||'';
      inv.settleDate=s.date||'';
    }
    changed=true;
  });
  if(changed)saveDB();
}

/* ---- 开票数据（按采购商聚合） ---- */
/** 聚合开票数据（按采购商汇总应收/已收金额并支持搜索和单位筛选）
 * @returns {Array} 开票数据数组，每项含unitId/unitName/records/totalReceivable/totalReceived
 */
function invoiceIssueData(){
  syncInvoices();
  // 先统计每个采购商的订单总额（去重聚合，避免同订单多次结算时重复计算）
  let orderTotal={};
  (DB.orders||[]).filter(function(o){return o.status==='签约完成'||o.status==='送货中'||o.status==='完成';}).forEach(function(o){
    if(!o.buyerId)return;
    orderTotal[o.buyerId]=(orderTotal[o.buyerId]||0)+orderSales(o);
  });
  let buyerMap={};
  (DB.invoices||[]).filter(function(inv){return inv.type==='issue';}).forEach(function(inv){
    if(!buyerMap[inv.unitId]){
      buyerMap[inv.unitId]={unitId:inv.unitId,unitName:inv.unitName,records:[],totalReceivable:0,totalReceived:0};
    }
    buyerMap[inv.unitId].records.push(inv);
    buyerMap[inv.unitId].totalReceived+=inv.amount||0;
  });
  // 从订单聚合应收总额
  Object.values(buyerMap).forEach(function(b){
    b.totalReceivable=orderTotal[b.unitId]||0;
  });
  // 追加独立结算单（无关联订单）的应收金额
  (DB.settlements||[]).forEach(function(s){
    if(s.type==='receipt' && (!s.orders||s.orders.length===0) && s.amount){
      if(buyerMap[s.unitId]){
        buyerMap[s.unitId].totalReceivable+=s.amount;
      }
    }
  });
  let list=Object.values(buyerMap);
  if(_invSearch){
    let q=_invSearch.toLowerCase().trim();
    list=list.filter(function(d){return d.unitName&&d.unitName.toLowerCase().includes(q);});
  }
  if(_invUnitFilter){
    list=list.filter(function(d){return d.unitId===_invUnitFilter;});
  }
  return list.sort(function(a,b){return b.totalReceivable-a.totalReceivable;});
}

/* ---- 收票数据（按供应商聚合） ---- */
/** 聚合收票数据（按供应商汇总应付/已付金额并支持搜索和单位筛选）
 * @returns {Array} 收票数据数组，每项含unitId/unitName/records/totalPayable/totalPaid
 */
function invoiceReceiveData(){
  syncInvoices();
  let supplierMap={};
  (DB.invoices||[]).filter(function(inv){return inv.type==='receive';}).forEach(function(inv){
    if(!supplierMap[inv.unitId]){
      supplierMap[inv.unitId]={unitId:inv.unitId,unitName:inv.unitName,records:[],totalPayable:0,totalPaid:0};
    }
    supplierMap[inv.unitId].records.push(inv);
    supplierMap[inv.unitId].totalPayable+=inv.payable||0;
    supplierMap[inv.unitId].totalPaid+=inv.amount||0;
  });
  let list=Object.values(supplierMap);
  if(_invSearch){
    let q=_invSearch.toLowerCase().trim();
    list=list.filter(function(d){return d.unitName&&d.unitName.toLowerCase().includes(q);});
  }
  if(_invUnitFilter){
    list=list.filter(function(d){return d.unitId===_invUnitFilter;});
  }
  return list.sort(function(a,b){return b.totalPayable-a.totalPayable;});
}

/* ---- 主视图 ---- */
/** 渲染发票管理主视图（开票/收票Tab、子Tab、搜索筛选、分页、统计卡片） */
/**
 * 发票管理主视图
 * 数据流：syncInvoices() → DB.invoices → DOM
 * 
 * 页面结构：
 * - 子Tab：开票记录/收票记录切换
 * - 状态Tab：未开票未收票/已开票已收票筛选
 * - 单位筛选：combo下拉选择
 * - 发票列表表格：单位、金额、状态、操作
 * - 明细抽屉：展开显示发票明细、新增/编辑发票记录
 * 
 * @param {string} type - 可选，'issue'|'receive'，指定默认Tab
 */
function viewInvoices(type){
  if(type)_invTab=type;
  syncInvoices();
  let issueData=invoiceIssueData();
  let receiveData=invoiceReceiveData();
  let allData=_invTab==='issue'?issueData:receiveData;

  // 子Tab过滤
  let unpaidData,paidData;
  if(_invTab==='issue'){
    unpaidData=allData.filter(function(d){
      return d.records.some(function(inv){return (inv.invoiceStatus||'未开票')==='未开票';});
    });
    paidData=allData.filter(function(d){
      return d.records.some(function(inv){return (inv.invoiceStatus||'未开票')==='已开票';});
    });
  }else{
    unpaidData=allData.filter(function(d){
      return d.records.some(function(inv){return (inv.receiveStatus||'未收票')==='未收票';});
    });
    paidData=allData.filter(function(d){
      return d.records.some(function(inv){
        let s=inv.receiveStatus||'未收票';
        return s==='已收票';
      });
    });
  }
  let activeData=_invSubTab==='unpaid'?unpaidData:paidData;

  // 搜索过滤
  if(_invSearch){
    let q=_invSearch.toLowerCase().trim();
    activeData=activeData.filter(function(d){
      if(d.unitName&&d.unitName.toLowerCase().includes(q))return true;
      return false;
    });
  }
  // 单位筛选
  if(_invUnitFilter){
    activeData=activeData.filter(function(d){return d.unitId===_invUnitFilter;});
  }

  // 分页
  let totalPages=Math.max(1,Math.ceil(activeData.length/PAGE_SIZE));
  if(_invPage>totalPages)_invPage=totalPages;
  let pageData=activeData.slice((_invPage-1)*PAGE_SIZE,_invPage*PAGE_SIZE);

  // 当前Tab统计（全局：应收/已收/未收，不被子Tab影响；子Tab只过滤表格显示）
  let tabTotal=0,tabDone=0,tabUndone=0;
  allData.forEach(function(d){
    d.records.forEach(function(inv){
      if(_invTab==='issue'){
        tabTotal+=inv.receivable||0;
        if((inv.invoiceStatus||'未开票')==='已开票')tabDone+=inv.amount||0;
      }else{
        tabTotal+=inv.payable||0;
        if((inv.receiveStatus||'未收票')==='已收票')tabDone+=inv.amount||0;
      }
    });
  });

  // 子Tab标签
  let subUnpaidLabel=_invTab==='issue'?'未开（'+unpaidData.length+'家）':'未收（'+unpaidData.length+'家）';
  let subPaidLabel=_invTab==='issue'?'已开（'+paidData.length+'家）':'已收（'+paidData.length+'家）';

  let rows=pageData.map(function(d){
    return d.records.filter(function(inv){
      if(_invTab==='issue'){
        let s=inv.invoiceStatus||'未开票';
        return _invSubTab==='unpaid'?s==='未开票':s==='已开票';
      }else{
        let s=inv.receiveStatus||'未收票';
        return _invSubTab==='unpaid'?s==='未收票':s==='已收票';
      }
    }).map(function(inv){
      let statusTag='';
      if(_invTab==='issue'){
        let sc=inv.invoiceStatus||'未开票';
        statusTag='<span class="tag '+(sc==='已开票'?'ok':'gray')+'">'+escHtml(sc)+'</span>';
      }else{
        let rc=inv.receiveStatus||'未收票';
        statusTag='<span class="tag '+(rc==='已收票'?'ok':'gray')+'">'+escHtml(rc)+'</span>';
      }
      let actBtns='<button class="btn xs" onclick="openInvEdit(\''+inv.id+'\')">'+icon('edit')+'编辑</button>';
      let gap=_invTab==='issue'?(inv.receivable||0)-(inv.amount||0):(inv.payable||0)-(inv.amount||0);
      return '<tr>'+
        '<td style="font-size:12px;color:var(--gray)">结算 '+escHtml(inv.settleDate)+'</td>'+
        '<td>'+escHtml(inv.unitName)+'</td>'+
        '<td>'+fmt(_invTab==='issue'?inv.receivable:inv.payable)+'</td>'+
        '<td style="color:'+(inv.amount>0?'var(--green)':'var(--gray)')+'">'+fmt(inv.amount)+'</td>'+
        '<td style="color:'+(gap>0?'var(--red)':'var(--gray)')+'">'+fmt(gap)+'</td>'+
        '<td>'+statusTag+'</td>'+
        '<td class="td-act">'+actBtns+'</td>'+
      '</tr>';
    }).join('');
  }).join('');

  let pg='<div id="invPaging">'+(totalPages>1?'<div style="display:flex;align-items:center;gap:6px;padding:10px 0;font-size:14px">'+icon('chevronLeft','14')+' <a href="javascript:void(0)" onclick="invPage('+(_invPage-1)+')" style="color:var(--blue);text-decoration:none'+( _invPage<=1?';visibility:hidden':'')+'">上一页</a><span style="padding:2px 10px;background:var(--bg-soft);border-radius:4px">'+_invPage+' / '+totalPages+'</span><a href="javascript:void(0)" onclick="invPage('+(_invPage+1)+')" style="color:var(--blue);text-decoration:none'+( _invPage>=totalPages?';visibility:hidden':'')+'">下一页</a> '+icon('chevronRight','14')+'</div>':'')+'</div>';

  let cols=_invTab==='issue'?
    '<th>结算日期</th><th>公司名称</th><th>应收金额</th><th>已收金额</th><th>未收金额</th><th>开票状态</th><th>操作</th>':
    '<th>结算日期</th><th>公司名称</th><th>应付金额</th><th>已付金额</th><th>未付金额</th><th>收票状态</th><th>操作</th>';
  let colSpan=7;

  tabUndone=Math.max(0,tabTotal-tabDone);

  return '<div class="toolbar">'+
    '<div class="search-box' + (_invSearch ? ' has-val' : '') + '" style="max-width:220px">'+
      '<a href="javascript:void(0)" data-search-fn="onInvSearch" onclick="onInvSearch(document.getElementById(\'invSearchInput\').value)" style="text-decoration:none;color:inherit;cursor:pointer;display:flex;align-items:center">'+icon('search','16')+'</a>'+
      '<input id="invSearchInput" type="text" tabindex="1" value="'+escAttr(_invSearch)+'" placeholder="搜索单位名称..." onkeydown="if(event.key===\'Enter\')onInvSearch(this.value)">'+
      '<span class="clear-btn" onclick="onInvSearch(\'\')">×</span>'+
    '</div>'+
    '<div class="spacer"></div>'+
  '</div>'+
  '<div class="stats" style="grid-template-columns:repeat(3,1fr)">'+
    '<div class="stat"><div class="k">'+(_invTab==='issue'?'应开发票总额':'应收票总额')+'</div><div class="v">'+fmt(tabTotal)+'</div></div>'+
    '<div class="stat"><div class="k">'+(_invTab==='issue'?'已开票总额':'已收票总额')+'</div><div class="v" style="color:var(--green)">'+fmt(tabDone)+'</div></div>'+
    '<div class="stat"><div class="k">'+(_invTab==='issue'?'未开票总额':'未收票总额')+'</div><div class="v" style="color:var(--red)">'+fmt(tabUndone)+'</div></div>'+
  '</div>'+
  // 子Tabs
  '<div class="settle-tabs" style="display:flex;border-bottom:2px solid var(--line);margin-bottom:16px">'+
    '<button class="settle-tab' + (_invSubTab === 'unpaid' ? ' active' : '') + '" onclick="switchInvSubTab(\'unpaid\')"><span>'+subUnpaidLabel+'</span></button>'+
    '<button class="settle-tab' + (_invSubTab === 'paid' ? ' active' : '') + '" onclick="switchInvSubTab(\'paid\')"><span>'+subPaidLabel+'</span></button>'+
  '</div>'+
  '<div class="card"><div class="table-wrap"><table><thead><tr>'+cols+'</tr></thead><tbody>'+
    (rows || '<tr><td colspan="'+colSpan+'">'+
      '<div class="empty-state">'+
        '<div class="es-icon">'+icon('receipt',28)+'</div>'+
        '<div class="es-title">'+(_invTab==='issue'?'暂无开票记录':'暂无收票记录')+'</div>'+
        '<div class="es-desc">'+(_invTab==='issue'?'从结算记录生成开票记录，管理开票状态':'从结算记录生成收票记录，跟踪收到的发票')+'</div>'+
        '<div class="es-action"><button class="btn primary" onclick="openInvEdit(\'\')">'+icon('plus')+'新增发票</button></div>'+
      '</div>'+
    '</td></tr>')+
  '</tbody></table></div>' + pg + '</div>';
}

/* ---- 切换子Tab ---- */
/** 切换未开/已开或未收/已收子Tab并重新渲染
 * @param {string} sub - 子Tab类型 'unpaid'|'paid'
 * @returns {void}
 */
function switchInvSubTab(sub){
  _invSubTab=sub;_invPage=1;
  render();
}

/* ---- 单位筛选 ---- */
/** 设置发票单位筛选条件并重新渲染
 * @param {string} val - 单位ID，空字符串表示清空筛选
 * @returns {void}
 */
function onInvUnitFilter(val){
  _invUnitFilter=val||'';
  _invPage=1;
  render();
}

/* ---- 搜索 ---- */
/** 设置发票搜索关键词并重新渲染（含搜索框高亮切换）
 * @param {string} v - 搜索关键词
 * @returns {void}
 */
function onInvSearch(v){
  _invSearch=v;_invPage=1;
  let box=document.querySelector('.search-box');
  if(box){if(v)box.classList.add('has-val');else box.classList.remove('has-val');}
  render();
}

/* ---- 分页 ---- */
/** 发票管理分页跳转
 * @param {number} n - 目标页码
 * @returns {void}
 */
function invPage(n){
  let allData=_invTab==='issue'?invoiceIssueData():invoiceReceiveData();
  let unpaidData,paidData;
  if(_invTab==='issue'){
    unpaidData=allData.filter(function(d){
      return d.records.some(function(inv){return (inv.invoiceStatus||'未开票')==='未开票';});
    });
    paidData=allData.filter(function(d){
      return d.records.some(function(inv){return (inv.invoiceStatus||'未开票')==='已开票';});
    });
  }else{
    unpaidData=allData.filter(function(d){
      return d.records.some(function(inv){return (inv.receiveStatus||'未收票')==='未收票';});
    });
    paidData=allData.filter(function(d){
      return d.records.some(function(inv){
        let s=inv.receiveStatus||'未收票';
        return s==='已收票';
      });
    });
  }
  let activeData=_invSubTab==='unpaid'?unpaidData:paidData;
  if(_invSearch){
    let q=_invSearch.toLowerCase().trim();
    activeData=activeData.filter(function(d){return d.unitName&&d.unitName.toLowerCase().includes(q);});
  }
  if(_invUnitFilter){
    activeData=activeData.filter(function(d){return d.unitId===_invUnitFilter;});
  }
  let total=Math.ceil(activeData.length/PAGE_SIZE)||1;
  _invPage=Math.max(1,Math.min(n,total));
  render();
}

/* ---- 编辑发票 ---- */
/** 打开发票编辑抽屉（含开票/收票表单、产品明细和发票抬头）
 * @param {string} invId - 发票记录ID
 * @returns {void}
 */
function openInvEdit(invId){
  let inv=(DB.invoices||[]).find(function(x){return x.id===invId;});
  if(!inv){toast('发票记录不存在','warning');return;}
  let isIssue=inv.type==='issue';

  // 从关联单位的发票抬头获取开票信息
  let invUnit=(DB.units||[]).find(function(u){return u.id===inv.unitId||u.name===inv.unitName;});
  let invHeader=invUnit&&invUnit.invoice;
  let autoTaxTitle=inv.taxTitle||'';
  if(!autoTaxTitle&&invHeader){
    autoTaxTitle=[invUnit.name,
      invHeader.taxId?'税号：'+invHeader.taxId:'',
      invHeader.address?'地址：'+invHeader.address:'',
      invHeader.phone?'电话：'+invHeader.phone:'',
      invHeader.bank?'开户行：'+invHeader.bank:'',
      invHeader.accountNo?'账号：'+invHeader.accountNo:''
    ].filter(Boolean).join('\n');
  }

  // 从关联订单中读取产品明细（实时数据，非 remark 解析）
  let productRows=[];
  let settlement=(DB.settlements||[]).find(function(s){return s.id===inv.settleId;});
  if(settlement){
    (settlement.orders||[]).forEach(function(so){
      let ord=(DB.orders||[]).find(function(o){return o.id===so.orderId;});
      if(!ord)return;
      (ord.items||[]).forEach(function(it){
        if(inv.type==='issue'){
          // 开票：显示全部产品项销售数据
          let total=itemQuotePrice(it)*(it.qty||0);
          productRows.push({sku:it.sku||it.name||'-',spec:it.spec||'',qty:it.qty||0,price:itemQuotePrice(it),total:total});
        }else{
          // 收票：按供应商筛选产品项
          let opts=itemOpts(it);
          opts.forEach(function(op){
            if(op.supplierId===settlement.unitId){
              let total=(op.price||0)*(op.allocQty||0);
              productRows.push({sku:it.sku||it.name||'-',spec:it.spec||'',qty:op.allocQty||0,price:op.price||0,total:total});
            }
          });
        }
      });
    });
  }

  let remarkHTML='';
  if(productRows.length){
    let remarkRows=productRows.map(function(r){
      return '<tr><td style="font-weight:600">'+escHtml(r.sku)+'</td><td>'+escHtml(r.spec||'—')+'</td><td>'+escHtml(fmtN(r.qty))+'</td><td>'+escHtml(fmt(r.price))+'</td><td>'+fmt(r.total)+'</td></tr>';
    }).join('');
    remarkHTML='<div class="table-wrap" style="margin-top:4px"><table><thead><tr><th>产品SKU</th><th>规格</th><th>数量</th><th>单价</th><th>金额</th></tr></thead><tbody>'+remarkRows+'</tbody></table></div>';
  }else{
    remarkHTML='<div style="padding:6px 0;font-size:12px;color:var(--gray)">无明细</div>';
  }

  let statusOpts=isIssue?
    INV_ISSUE_STATUS.map(function(s){return '<option value="'+s+'"'+(inv.invoiceStatus===s?' selected':'')+'>'+s+'</option>';}).join(''):
    INV_RECEIVE_STATUS.map(function(s){return '<option value="'+s+'"'+(inv.receiveStatus===s?' selected':'')+'>'+s+'</option>';}).join('');

  let body=
    '<div class="field" style="margin-bottom:10px"><label class="f">关联单位</label><div style="padding:6px 0;font-weight:600">'+escHtml(inv.unitName)+'</div></div>'+
    '<div class="grid2" style="gap:12px;margin-bottom:10px">'+
      '<div class="field" style="margin:0"><label class="f">结算日期</label><div style="padding:6px 0">'+escHtml(inv.settleDate)+'</div></div>'+
      '<div class="field" style="margin:0"><label class="f">结算金额</label><div style="padding:6px 0;font-weight:600">'+fmt(inv.amount)+'</div></div>'+
    '</div>'+
    '<div class="field" style="margin-bottom:10px"><label class="f">产品明细</label>'+remarkHTML+'</div>'+
    (isIssue?
      '<div class="grid3" style="gap:12px;margin-bottom:10px">'+
        '<div class="field" style="margin:0"><label class="f">开票时间</label><input id="invEdit_date" type="date" tabindex="10" value="'+escAttr(inv.invoiceDate||'')+'"></div>'+
        '<div class="field" style="margin:0"><label class="f">发票号码</label><input id="invEdit_number" tabindex="11" value="'+escAttr(inv.invoiceNumber||'')+'" placeholder="发票号码"></div>'+
        '<div class="field" style="margin:0"><label class="f">开票状态</label><select id="invEdit_status" tabindex="12">'+statusOpts+'</select></div>'+
      '</div>'+
      '<div class="grid2" style="gap:12px">'+
        '<div class="field" style="margin:0"><label class="f">结算备注</label><textarea id="invEdit_remark" rows="3" tabindex="13" style="width:100%;font-size:12px;resize:vertical" placeholder="付款/收款时填写的备注">'+escHtml(inv.settleNote||'')+'</textarea></div>'+
        '<div class="field" style="margin:0"><label class="f">企业抬头</label><textarea id="invEdit_title" rows="4" tabindex="14" style="width:100%;font-size:12px;resize:vertical" placeholder="开票企业抬头信息">'+escHtml(autoTaxTitle)+'</textarea></div>'+
      '</div>'
    :
      '<div class="grid3" style="gap:12px;margin-bottom:10px">'+
        '<div class="field" style="margin:0"><label class="f">收票日期</label><input id="invEdit_recvDate" type="date" tabindex="10" value="'+escAttr(inv.receiveDate||'')+'"></div>'+
        '<div class="field" style="margin:0"><label class="f">发票号码</label><input id="invEdit_number" tabindex="11" value="'+escAttr(inv.invoiceNumber||'')+'" placeholder="发票号码"></div>'+
        '<div class="field" style="margin:0"><label class="f">收票状态</label><select id="invEdit_status" tabindex="12">'+statusOpts+'</select></div>'+
      '</div>'+
      '<div class="field" style="margin-bottom:12px"><label class="f">结算备注</label><textarea id="invEdit_remark" rows="3" tabindex="13" style="width:100%;font-size:12px;resize:vertical" placeholder="付款/收款时填写的备注">'+escHtml(inv.settleNote||'')+'</textarea></div>'
    );

  openDrawer('编辑发票 · '+escHtml(inv.id),body,function(){
    // 防重锁：防止重复点击导致重复保存
    if(_invEditSaving){toast('正在保存中，请稍候...','info');return;}
    _invEditSaving=true;
    setTimeout(function(){_invEditSaving=false;},500);
    inv.settleNote=document.getElementById('invEdit_remark').value.trim();
    inv.invoiceNumber=document.getElementById('invEdit_number').value.trim();
    if(isIssue){
      inv.invoiceDate=document.getElementById('invEdit_date').value;
      inv.taxTitle=document.getElementById('invEdit_title').value.trim();
      inv.invoiceStatus=document.getElementById('invEdit_status').value;
      if(inv.invoiceStatus==='已开票' && !inv.invoiceDate){
        toast('已开票状态必须填写开票时间','error');
        return;
      }
    }else{
      inv.receiveStatus=document.getElementById('invEdit_status').value;
      inv.receiveDate=document.getElementById('invEdit_recvDate').value||'';
      if(inv.receiveStatus==='已收票' && !inv.receiveDate){
        toast('建议填写收票日期（当前已收票）','warn');
      }
    }
    saveDB();
    closeDrawer();
    render();
    toast('发票信息已更新','success');
  },false,false);
}
