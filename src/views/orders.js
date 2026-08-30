// views/orders.js — 采购订单
/* =========================================================
   采购订单 - 列表
   ========================================================= */
/** 格式化交货期字段（支持字符串和对象格式） */
function fmtDelivery(d){return typeof d==='object'?(d.time||''):(d||'');}
/* 订单列表行渲染（viewOrders 和 refreshOrderList 共用） */
/** 渲染单条采购订单表格行 */
function renderOrderRow(o){
  return '<tr>'+
    '<td><input type="checkbox" class="order-check" data-id="'+o.id+'" onchange="updateOrderBatchBtn()"></td>'+
    '<td><b>'+escHtml(o.id)+'</b></td>'+
    '<td>'+escHtml(pName(o.buyerId))+'</td>'+
    '<td class="m-hide-s1">'+escHtml(o.buyerContact||'-')+'</td>'+
    '<td class="m-hide-s2">'+escHtml(o.project||'-')+'</td>'+
    '<td class="m-hide-s2">'+o.items.length+' 项</td>'+
    '<td>'+escHtml(fmtDelivery(o.delivery))+'</td>'+
    '<td><span class="tag '+STATUS_COLORS[o.status]+'">'+escHtml(o.status)+'</span></td>'+
    '<td class="td-act"><button class="btn sm" onclick="goOrderView(\''+o.id+'\')" title="查看" aria-label="查看">'+icon('fileText')+'查看</button><button class="btn sm" onclick="goOrderEdit(\''+o.id+'\')" title="编辑" aria-label="编辑">'+icon('edit')+'编辑</button></td>'+
  '</tr>';
}
/** 渲染采购订单列表空状态行 */
function renderOrderEmptyRow(){
  const hasFilter=orderSearch||orderStatusFilter;
  return '<tr><td colspan="9">'+
    '<div class="empty-state">'+
      '<div class="es-icon">'+icon('doc',28)+'</div>'+
      '<div class="es-title">'+(hasFilter?'无匹配订单':'暂无采购订单')+'</div>'+
      '<div class="es-desc">'+(hasFilter?'试试调整搜索关键词或清除筛选条件':'点击下方按钮创建第一个采购订单，管理供应商报价和发货进度')+'</div>'+
      '<div class="es-action">'+
        (hasFilter?'<button class="btn ghost" onclick="onOrderSearch(\'\');orderStatusFilter=\'\';onOrderStatusFilter(\'\')">'+icon('x','14')+'清除筛选</button>':'')+
        '<button class="btn primary" onclick="newOrder()" style="margin-left:'+(hasFilter?'8px':'0')+'">'+icon('plus')+'新建采购订单</button>'+
      '</div>'+
    '</div>'+
  '</td></tr>';
}
/** 渲染采购订单列表视图（含搜索、筛选、分页） */
function viewOrders(){
  const all=filterOrdersData();
  const totalPages=Math.max(1,Math.ceil(all.length/PAGE_SIZE));
  if(_orderPage>totalPages)_orderPage=totalPages;
  const pageData=all.slice((_orderPage-1)*PAGE_SIZE,_orderPage*PAGE_SIZE);
  const rows=pageData.map(renderOrderRow).join('');
  const total=DB.orders.length;
  const matched=all.length;
  const countTag=(orderSearch||orderStatusFilter)?'<span id="orderCountTag" class="tag gray" style="margin-left:8px">'+matched+' / '+total+'</span>':'<span id="orderCountTag" class="tag gray" style="margin-left:8px;display:none"></span>';
  const pg=buildPaging(all.length,_orderPage,totalPages,'orderPage',{id:'orderPaging'});
  return '<div class="toolbar">'+
    '<div class="search-box'+(orderSearch?' has-val':'')+'">'+
      '<a href="javascript:void(0)" data-search-fn="onOrderSearch" onclick="onOrderSearch(document.getElementById(\'orderSearchInput\').value)" style="text-decoration:none;color:inherit;cursor:pointer;display:flex;align-items:center">'+icon('search','16')+'</a>'+
      '<input id="orderSearchInput" type="text" value="'+escAttr(orderSearch)+'" placeholder="搜索单号、采购商、项目、对接人..." onkeydown="if(event.key===\'Enter\'&&!event.isComposing)onOrderSearch(this.value)">'+
      '<span class="clear-btn" onclick="onOrderSearch(\'\')">×</span>'+
    '</div>'+
    '<select id="orderStatusFilter" style="width:130px" onchange="onOrderStatusFilter(this.value)" tabindex="2">'+
      '<option value="">全部状态</option>'+
      ORDER_STATUSES.map(s=>'<option value="'+s+'"'+(orderStatusFilter===s?' selected':'')+'>'+s+'</option>').join('')+
    '</select>'+
    '<div class="spacer"></div>'+
    countTag+
    '<button id="orderBatchDelBtn" class="btn sm" style="display:none" onclick="batchDeleteOrders()">'+icon('trash')+'批量删除(<span id="orderBatchCount">0</span>)</button>'+
    '<button class="btn primary" onclick="newOrder()">'+icon('plus')+'新建采购订单</button>'+
  '</div>'+
  '<div class="card"><div class="table-wrap"><table><thead><tr><th style="width:40px"><input type="checkbox" onchange="toggleAllOrders(this)" title="全选"></th><th>单号</th><th>采购商</th><th class="m-hide-s1">对接人</th><th class="m-hide-s2">项目</th><th class="m-hide-s2">产品项</th><th>交期</th><th>状态</th><th></th></tr></thead><tbody id="orderBody">'+
  (rows||renderOrderEmptyRow())+
  '</tbody></table></div>'+pg+'</div>';
}
/** 局部刷新采购订单列表（不重新渲染整个页面） */
function refreshOrderList(){
  const body=document.getElementById('orderBody');
  const paging=document.getElementById('orderPaging');
  if(!body)return;
  const all=filterOrdersData();
  const totalPages=Math.max(1,Math.ceil(all.length/PAGE_SIZE));
  if(_orderPage>totalPages)_orderPage=totalPages;
  const pageData=all.slice((_orderPage-1)*PAGE_SIZE,_orderPage*PAGE_SIZE);
  const rows=pageData.map(renderOrderRow).join('');
  body.innerHTML=rows||renderOrderEmptyRow();
  if(paging)paging.innerHTML=totalPages>1?buildPaging(all.length,_orderPage,totalPages,'orderPage',{id:'orderPaging',showCount:false}):'';
  const tag=document.getElementById('orderCountTag');
  if(tag){const total=DB.orders.length,matched=all.length;tag.style.display=(orderSearch||orderStatusFilter)?'':'none';tag.textContent=matched+' / '+total;}
}
/* =========================================================
   采购订单 - 详情查看
   ========================================================= */
/**
 * 订单详情页视图（只读展示）
 * 数据流：DB.orders[curOrderView] → DOM
 * 包含：状态流转条、产品明细表、送货信息、供应商汇总、相关联系人
 */
function viewOrderDetail(){
  const o=DB.orders.find(x=>x.id===curOrderView);
  if(!o){view='orders';return viewOrders();}
  const flowIdx=STATUS_FLOW.indexOf(o.status);
  const showRcv=RECEIVABLE_STATUSES.includes(o.status);
  const locked=['签约完成','送货中','完成'].includes(o.status);
  const editLocked=o.status==='完成';
  const rcvLocked=o.status!=='签约完成';
  const flowHTML='<div class="status-flow">'+
    STATUS_FLOW.map((s,i)=>{
      const cls=i<flowIdx?'done':(i===flowIdx?'cur':'');
      const num=i+1;
      return '<div class="sf-step '+cls+'"><div class="sf-dot">'+num+'</div><span>'+s+'</span></div>'+(i<STATUS_FLOW.length-1?'<span class="sf-arrow">→</span>':'');
    }).join('')+
    (o.status==='异常'?'<span class="tag err">异常</span>':'')+
    (o.status==='取消'?'<span class="tag gray">取消</span>':'')+
    (o.status==='未成交'?'<span class="tag gray">未成交</span>':'')+
  '</div>';
  const itemRows=o.items.map((it,i)=>{
    const profit=itemProfit(it);
    const allocSum=itemAllocSum(it);
    const [srcTxt,srcCls]=itemSourcingStatus(it);
    const opts=itemOpts(it);
    const supplierHTML=(opts.length?opts.map(o=>{
      const lineProfit=(itemQuotePrice(it)-(o.price||0))*(o.allocQty||0);
      return '<div style="margin-bottom:4px;padding-bottom:4px;border-bottom:1px dashed var(--line)">'+
        contactTooltip(o.supplierId)+
        ' · 采购价: '+fmt(o.price)+' · 分配: <b>'+fmtN(o.allocQty)+'千支</b>'+
        ' · 利润: <span class="'+(lineProfit>=0?'profit-pos':'profit-neg')+'">'+fmt(lineProfit)+'</span>'+
        ' · 总金额: '+fmt((o.price||0)*(o.allocQty||0))+
        (o.source==='manual'?' <span class="tag purple">手动</span>':'')+
      '</div>';
    }).join(''):'<span class="tag warn">未寻货</span>')+
    (o.status==='寻货中'&&allocSum<it.qty?' <button class="btn sm primary" style="margin-top:4px" onclick="sourceItemFromDetail('+i+')">'+icon('search')+'寻货</button>':'')+
    (allocSum>0&&allocSum>=it.qty&&!locked?' <button class="btn sm" style="margin-top:4px" onclick="sourceItemFromDetail('+i+')">'+icon('building')+'管理供应商</button>':'');
    return '<tr id="detail-row-'+i+'">'+
      '<td style="font-weight:600">'+escHtml(it.sku||it.name||'')+'</td>'+
      '<td style="color:var(--accent);font-weight:600">'+escHtml(it.spec||'')+'</td>'+
      '<td>'+specTags(it)+'</td>'+
      '<td>'+fmtN(it.qty)+'</td>'+
      '<td>'+fmt(it.salePrice)+'</td>'+
      '<td>'+fmt(it.quotePrice)+'</td>'+
      '<td>'+supplierHTML+'</td>'+
      '<td>'+(opts.length?'<span class="tag '+srcCls+'">'+srcTxt+' '+fmtN(allocSum)+'/'+fmtN(it.qty)+'</span>':'<span class="tag gray">待寻源</span>')+'</td>'+
      '<td>'+(opts.length?'<span class="'+(profit>=0?'profit-pos':'profit-neg')+'">'+fmt(profit)+'</span>':'-')+'</td>'+
      '<td>'+escHtml(it.usage||'-')+'</td>'+
    '</tr>';
  }).join('');
  const supplierIds = [...new Set(o.items.flatMap(it => itemOpts(it).map(o2 => o2.supplierId)).filter(Boolean))];
  const contactRows = supplierIds.flatMap(sid => {
    const u = DB.units.find(x => x.id === sid);
    if (!u || !u.contacts || !u.contacts.length) return [];
    return u.contacts.map(c => '<tr><td>'+escHtml(c.name)+'</td><td>'+escHtml(u.name)+'</td><td>'+escHtml(c.phone||'-')+'</td><td>'+escHtml(c.wechat||'-')+'</td></tr>');
  }).join('');
  const relatedContactsHTML = contactRows ? 
    '<div style="margin-top:18px"><h3 style="font-size:15px;font-weight:600;margin-bottom:12px;display:flex;align-items:center;gap:8px">'+icon('link','16')+'相关联系人</h3><div class="table-wrap"><table><thead><tr><th>姓名</th><th>公司</th><th>电话</th><th>微信号</th></tr></thead><tbody>'+contactRows+'</tbody></table></div></div>' : '';
  const nextBtnHTML=nextStepButton(o);
  const prevBtnHTML=prevStepButton(o);
  const cancelBtnHTML=['待确认','寻货中','报价中'].includes(o.status)?'<button class="btn danger" title="将订单标记为「取消」状态，不可恢复正常流程" onclick="cancelOrderConfirm(\''+o.id+'\')">'+icon('x','16')+' 取消订单</button>':'';
  const markAbnormalBtnHTML=['报价中','签约完成','送货中'].includes(o.status)?'<button class="btn" title="将订单标记为「异常」状态，需重点关注处理（终态，不可恢复）" onclick="markOrderAbnormal(\''+o.id+'\')">'+icon('alertTriangle','16')+' 标记异常</button>':'';
  return '<div class="toolbar">'+
    '<button class="btn sm" onclick="go(\'orders\')">'+icon('arrowLeft')+'返回列表</button>'+
    '<button class="btn sm" onclick="exportOrder(\''+o.id+'\')">'+icon('download','16')+'导出Excel</button>'+
    '<div class="spacer"></div>'+
    (locked?'':prevBtnHTML)+
    (editLocked?'':'<button class="btn" onclick="goOrderEdit(\''+o.id+'\')">'+icon('edit')+'编辑订单</button>')+
    (o.status==='送货中'?'<button class="btn primary" title="确认订单完成，所有信息锁定只读" onclick="confirmOrderComplete(\''+o.id+'\')">'+icon('check','16')+' 订单完成</button>':'')+
    (function(){
      if(o.status!=='签约完成')return'';
      const rows=[];o.items.forEach(function(it){itemOpts(it).forEach(function(opt){rows.push(opt);});});
      if(!rows.length)return'';
      return '<button class="btn primary" title="进入「送货中」状态。未全部收货会弹窗提醒，仍可强行进入后补录。" onclick="nextStepEnterDelivery(\''+o.id+'\')">'+icon('package','16')+' 进入送货</button>';
    }())+
    (locked?'':cancelBtnHTML)+
    markAbnormalBtnHTML+
    (locked?'':nextBtnHTML)+
  '</div>'+
  '<div class="card">'+
    '<h2>'+icon('doc','18')+escHtml(o.id)+' · '+escHtml(pName(o.buyerId))+
      '<button class="btn" style="margin-left:auto" title="复制为新的待确认订单，保留客户/产品/供应商分配与报价，可按需删除" onclick="copyOrder(\''+o.id+'\')">'+icon('copy','16')+' 复制订单</button>'+
    '</h2>'+
    flowHTML+
    '<div class="grid2" style="margin-bottom:16px">'+
      '<div><label class="f">采购商</label><div><b>'+escHtml(pName(o.buyerId))+'</b>'+(o.buyerContact?' · 对接: '+escHtml(o.buyerContact):'')+'</div></div>'+
      '<div><label class="f">项目 / 交期</label><div>'+escHtml(o.project||'-')+' · 交期 '+escHtml(fmtDelivery(o.delivery))+'</div></div>'+
    '</div>'+
    (o.remark?'<div style="margin-bottom:16px"><label class="f">订单备注</label><div>'+escHtml(o.remark)+'</div></div>':'')+
    (o.status==='签约完成'?'<div id="inspection-notice-'+o.id+'"></div>':'')+
    (o.status==='送货中'?(o.delivery?
      '<div style="margin-bottom:16px;background:var(--green-l);border:1px solid var(--green-line);border-radius:8px;padding:16px">'+
        '<div style="font-weight:600;margin-bottom:12px;display:flex;align-items:center;gap:8px">'+icon('package','16')+' 送货信息 <span class="tag info">送货中</span><span class="muted" style="margin-left:auto;font-size:12px">'+escHtml(o.delivery.time||'-')+'</span></div>'+
        '<div id="delivery-readonly-'+o.id+'">'+
          '<div class="grid3" style="gap:16px">'+
            '<div><label class="muted" style="font-size:12px">送货地址</label><div style="font-weight:500;margin-top:2px">'+escHtml(o.delivery.address||'-')+'</div></div>'+
            '<div><label class="muted" style="font-size:12px">快递单号</label><div style="font-weight:500;margin-top:2px">'+escHtml(o.delivery.tracking||'-')+'</div></div>'+
          '</div>'+
          '<div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--green-line);display:flex;gap:8px">'+
            '<button class="btn" onclick="enterEditDelivery(\''+o.id+'\')">'+icon('edit','14')+' 修改送货信息</button>'+
          '</div>'+
        '</div>'+
        '<div id="delivery-edit-'+o.id+'" style="display:none">'+
          '<div class="grid2" style="gap:12px">'+
            '<div><label class="f">送货地址</label><input id="del_addr_'+o.id+'" tabindex="20" style="width:100%" value="'+escAttr(o.delivery.address||'')+'"></div>'+
            '<div><label class="f">快递单号</label><input id="del_track_'+o.id+'" tabindex="21" style="width:100%" value="'+escAttr(o.delivery.tracking||'')+'"></div>'+
          '</div>'+
          '<div style="margin-top:12px"><label class="f">送货时间</label><input id="del_time_'+o.id+'" type="date" tabindex="22" min="'+today()+'" style="width:220px" value="'+escAttr(o.delivery.time||'')+'"></div>'+
          '<div style="margin-top:12px;display:flex;gap:8px">'+
            '<button class="btn sm primary" onclick="saveDeliveryInfo(\''+o.id+'\')">保存</button>'+
            '<button class="btn sm" onclick="cancelEditDelivery(\''+o.id+'\')">取消</button>'+
          '</div>'+
        '</div>'+
      '</div>':
      '<div style="margin-bottom:16px;background:var(--pri-l);border:1px solid var(--pri-p);border-radius:8px;padding:16px">'+
        '<div style="display:flex;justify-content:space-between;align-items:center">'+
          '<div><b>'+icon('package','16')+' 送货信息</b><span class="muted" style="margin-left:8px;font-size:13px">验货已完成，请填写快递发货信息</span></div>'+
        '</div>'+
        '<div class="grid2" style="gap:12px;margin-top:12px">'+
          '<div><label class="f">送货地址</label><input id="del_addr_'+o.id+'" tabindex="20" style="width:100%" placeholder="收货地址"></div>'+
          '<div><label class="f">快递单号</label><input id="del_track_'+o.id+'" tabindex="21" style="width:100%" placeholder="快递单号"></div>'+
        '</div>'+
        '<div style="margin-top:12px"><label class="f">送货时间</label><input id="del_time_'+o.id+'" type="date" tabindex="22" min="'+today()+'" style="width:220px"></div>'+
        '<div style="margin-top:12px">'+
          '<button class="btn sm primary" onclick="saveDeliveryInfo(\''+o.id+'\')">保存发货信息</button>'+
        '</div>'+
      '</div>'
    ):'')+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin:18px 0 10px">'+
      '<h3 style="font-size:15px;font-weight:600;margin:0;display:flex;align-items:center;gap:8px">'+icon('package','16')+'产品明细</h3>'+
      '<div style="display:flex;gap:8px">'+
        (o.status==='寻货中'?'<button class="btn sm primary" onclick="openSupplierQuoteImport()">'+icon('upload')+'批量导入供应商报价</button>':'')+
        (locked?'':'<button class="btn sm" onclick="openGenerateQuote()">'+icon('tag','14')+'生成报价</button>')+
      '</div>'+
    '</div>'+
    '<div class="table-wrap"><table><thead><tr><th>SKU</th><th>规格</th><th>属性</th><th>数量(千支)</th><th>意向价</th><th>报价</th><th>供应商（多供应商分配）</th><th>寻源状态</th><th>行利润</th><th>用途</th></tr></thead><tbody>'+
    (itemRows||'<tr><td colspan="8"><div class="no-data">暂无产品</div></td></tr>')+
    '</tbody></table></div>'+
    '<div style="margin-top:18px;display:flex;gap:36px;flex-wrap:wrap;background:var(--bg-tint);border:1px solid var(--line);border-radius:8px;padding:18px" id="detail-stats">'+
      '<div><span class="muted" style="font-size:14px">意向金额</span><b id="st_intent" style="display:block;font-size:22px;margin-top:4px">'+fmt(orderIntent(o))+'</b></div>'+
      '<div><span class="muted" style="font-size:14px">报价总额</span><b id="st_sales" style="display:block;font-size:22px;margin-top:4px">'+fmt(orderSales(o))+'</b></div>'+
      '<div><span class="muted" style="font-size:14px">采购总成本</span><b id="st_cost" style="display:block;font-size:22px;margin-top:4px">'+fmt(orderCost(o))+'</b></div>'+
      '<div><span class="muted" style="font-size:14px">预估利润</span><b id="st_profit" style="display:block;font-size:22px;margin-top:4px;color:var(--green)">'+fmt(orderProfit(o))+'</b></div>'+
    '</div>'+
    (o.status==='签约完成'?renderInspectionSection(o):'')+
    (showRcv?receiveManageSection(o,rcvLocked):'')+
  '</div>';
}
/** 更改采购订单状态并持久化 */
function changeOrderStatus(id,status){
  const o=DB.orders.find(x=>x.id===id);
  if(!o)return;
  o.status=status;
  o.statusChangedAt=now();
  saveDB();render();toast('订单状态已更改为「'+status+'」','success');
}
/** 根据当前状态返回专属「下一步」按钮 HTML。未完结状态返回按钮；完成/异常/取消/未成交返回空。 */
function nextStepButton(o){
  if(o.status==='待确认'){
    return '<button class="btn primary" title="校验产品列表与意向价后进入「寻货中」" onclick="nextStepStartSourcing(\''+o.id+'\')">'+icon('search','16')+' 开始寻货</button>';
  }
  if(o.status==='寻货中'){
    return '<button class="btn primary" title="校验所有产品已分配（已确认）后进入「报价中」" onclick="nextStepFinishSourcing(\''+o.id+'\')">'+icon('check','16')+' 完成寻货</button>';
  }
  if(o.status==='报价中'){
    return '<div style="display:flex;gap:8px">'+
      '<button class="btn primary" title="确认合同已签署，进入「签约完成」状态，可开始收货管理，合同修改可直接编辑订单" onclick="nextStepConfirmSign(\''+o.id+'\')">'+icon('check','16')+' 确认签约</button>'+
      '<button class="btn" title="报价后客户未确认，标记为「未成交」，可随时一键恢复继续跟进" onclick="markOrderNoDeal(\''+o.id+'\')">'+icon('x','16')+' 标记未成交</button>'+
    '</div>';
  }
  if(o.status==='未成交'){
    return '<button class="btn primary" title="一键恢复为「报价中」，继续跟进该订单" onclick="restoreOrderQuoting(\''+o.id+'\')">'+icon('refresh','16')+' 恢复为报价中</button>';
  }
  return '';
}
/** 「待确认 → 寻货中」：校验产品列表非空+每行有意向价；不满足 toast 提醒不跳转 */
function nextStepStartSourcing(id){
  const o=DB.orders.find(x=>x.id===id);if(!o)return;
  const items=o.items||[];
  const missing=[];
  if(!items.length){
    missing.push('订单无任何产品行');
  }else{
    items.forEach((it,i)=>{
      if(!(it.sku||it.name))missing.push('第 '+(i+1)+' 行产品名称/SKU 未填');
      if(!(it.spec))missing.push('第 '+(i+1)+' 行规格未填');
      if(!(it.salePrice>0))missing.push('第 '+(i+1)+' 行未设意向价');
    });
  }
  if(missing.length){
    toast('开始寻货前需补齐：'+missing.join('；'),'warning');
    return;
  }
  changeOrderStatus(id,'寻货中');
}
/** 「寻货中 → 报价中」：校验所有产品已「已确认」（已分配≥需求）；不满足 toast 提醒不跳转 */
function nextStepFinishSourcing(id){
  const o=DB.orders.find(x=>x.id===id);if(!o)return;
  const items=o.items||[];
  const unfinished=[];
  items.forEach((it,i)=>{
    const alloc=itemAllocSum(it);
    if(alloc<it.qty){
      unfinished.push('第 '+(i+1)+' 行 '+(it.sku||it.name||'未命名')+' 尚未寻满（已分配 '+fmtN(alloc)+' / '+fmtN(it.qty)+'千支）');
    }else if(!itemOpts(it).length){
      unfinished.push('第 '+(i+1)+' 行 '+(it.sku||it.name||'未命名')+' 未添加供应商');
    }
  });
  if(unfinished.length){
    toast('完成寻货前需补齐：'+unfinished.join('；'),'warning');
    return;
  }
  changeOrderStatus(id,'报价中');
}
/** 「报价中 → 签约完成」：确认弹窗后切换状态 */
function nextStepConfirmSign(id){
  confirmModal(
    '确认合同已与采购商签署完成？<br><span class="muted" style="font-size:12px">完成后将进入「签约完成」状态，可开始收货管理；合同如需修改可直接编辑订单，进入送货后锁定只读。</span>',
    function(){changeOrderStatus(id,'签约完成');},
    '确认签约',
    null,null,
    true
  );
}
/** 「报价中 → 未成交」：报价后客户未确认，确认弹窗后切换；可一键恢复为报价中 */
function markOrderNoDeal(id){
  confirmModal(
    '确认标记为「未成交」？<br><span class="muted" style="font-size:12px">未成交代表报价后客户未确认，订单不参与应收/利润/待办统计；可随时一键恢复为「报价中」继续跟进。</span>',
    function(){changeOrderStatus(id,'未成交');},
    '标记未成交',
    null,null,
    true
  );
}
/** 「未成交 → 报价中」：一键恢复继续跟进 */
function restoreOrderQuoting(id){
  const o=DB.orders.find(x=>x.id===id);if(!o)return;
  changeOrderStatus(id,'报价中');
}
/** 「签约完成 → 送货中」：校验收货情况。未全部收货弹窗列出提醒，确认后仍可强行进入 */
function nextStepEnterDelivery(id){
  const o=DB.orders.find(x=>x.id===id);if(!o)return;
  const rows=[];
  o.items.forEach(it=>{itemOpts(it).forEach(opt=>{rows.push(opt);});});
  if(!rows.length){changeOrderStatus(id,'送货中');return;}
  const total=rows.length;
  const received=rows.filter(r=>r.received).length;
  const pending=rows.filter(r=>!r.received);
  if(pending.length){
    const list=pending.map(r=>{
      const it=o.items.find(x=>(x.options||[]).includes(r));
      const name=it?(it.sku||it.name||'未命名'):'未命名';
      const sup=pName(r.supplierId);
      return '<li>'+escHtml(name)+' · '+escHtml(sup)+'</li>';
    }).join('');
    confirmModal(
      '收货尚未完成（已收到 '+received+' / '+total+' 条）：<br><ul style="margin:8px 0 0 16px;color:var(--warn)">'+list+'</ul>'+
      '<div class="muted" style="margin-top:8px;font-size:12px">确认进入「送货中」后，仍可在收货管理中继续补录未收记录。</div>',
      function(){changeOrderStatus(id,'送货中');},
      '仍然进入送货','返回补齐收货',
      null,true
    );
    return;
  }
  changeOrderStatus(id,'送货中');
}
/** 根据当前状态返回「上一步」按钮 HTML。待确认/完成/异常/取消无上一步 */
function prevStepButton(o){
  const idx=STATUS_FLOW.indexOf(o.status);
  if(idx<=0)return '';
  const prev=STATUS_FLOW[idx-1];
  return '<button class="btn" title="返回上一步：'+escAttr(prev)+'" onclick="prevStepOrder(\''+o.id+'\',\''+prev+'\')">'+icon('arrowLeft','16')+' 上一步（'+prev+'）</button>';
}
/** 检查订单是否被结算记录引用（用于回退前校验，防孤儿结算/发票）
 * @param {string} id - 订单 ID
 * @returns {Array} 引用该订单的结算记录数组 */
function _orderLinkedSettlements(id){
  return (DB.settlements||[]).filter(function(s){return (s.orders||[]).some(function(oe){return oe.orderId===id;});});
}
/** 返回上一步。v1.0.27 起：从「签约完成/送货中/完成」回退到非结算关联状态时，
 * 校验结算关联，有则弹窗警告防孤儿数据；其余情况直接切换。
 * @param {string} id - 订单 ID
 * @param {string} target - 目标状态（STATUS_FLOW 上一态） */
function prevStepOrder(id,target){
  const o=DB.orders.find(x=>x.id===id);if(!o)return;
  const FROM_SETTLE=['签约完成','送货中','完成'];
  const TO_NON_SETTLE=['待确认','寻货中','报价中','未成交'];
  if(FROM_SETTLE.includes(o.status)&&TO_NON_SETTLE.includes(target)){
    const linked=_orderLinkedSettlements(id);
    if(linked.length){
      const ids=linked.map(function(s){return s.id;}).join('、');
      confirmModal(
        '该订单已关联 <b>'+linked.length+' 笔结算记录</b>（'+escHtml(ids)+'）。<br>'+
        '<span class="muted" style="font-size:12px">回退到「'+escHtml(target)+'」后，结算列表将不再显示该订单，但结算记录仍引用它，可能造成数据不一致。建议先在结算管理处理关联记录。</span>',
        function(){changeOrderStatus(id,target);},
        '仍然回退','返回',
        null,true
      );
      return;
    }
  }
  changeOrderStatus(id,target);
}
/** 「待确认 → 取消」：确认弹窗 */
function cancelOrderConfirm(id){
  confirmModal(
    '确认取消此订单？<br><span class="muted" style="font-size:12px">取消后订单将进入「取消」状态，不可再恢复正常流程。</span>',
    function(){changeOrderStatus(id,'取消');},
    '确认取消',
    null,null,
    true
  );
}
/** 「报价中/签约完成/送货中 → 异常」：人工标记异常（终态），确认弹窗后切换。
 * v1.0.27 起：补齐异常状态的人工入口，此前仅 AI flow_order_status 可进入。 */
function markOrderAbnormal(id){
  confirmModal(
    '确认将此订单标记为「异常」？<br><span class="muted" style="font-size:12px">异常为终态，标记后不可恢复正常流程。适用于质量问题、客户纠纷等需重点关注的情况；可在订单备注中记录异常原因。</span>',
    function(){changeOrderStatus(id,'异常');},
    '确认标记异常','取消',
    null,true
  );
}
/** 保存送货信息并更新订单状态为"送货中" */
function saveDeliveryInfo(id){
  const o=DB.orders.find(x=>x.id===id);
  if(!o)return;
  const address=document.getElementById('del_addr_'+id).value.trim();
  const tracking=document.getElementById('del_track_'+id).value.trim();
  const time=document.getElementById('del_time_'+id).value;
  if(!address){toast('请填写送货地址','error');return;}
  if(!tracking){toast('请填写快递单号','error');return;}
  if(!time){toast('请选择送货时间','error');return;}
  o.delivery={address,tracking,time};
  o.updatedAt=now();
  saveDB();render();toast('送货信息已保存','success');
}
/** 切换送货信息为可编辑状态 */
function enterEditDelivery(id){
  const ro=document.getElementById('delivery-readonly-'+id);
  const ed=document.getElementById('delivery-edit-'+id);
  if(ro)ro.style.display='none';
  if(ed)ed.style.display='block';
  const inp=document.getElementById('del_addr_'+id);
  if(inp)inp.focus();
}
/** 取消编辑送货信息，恢复只读 */
function cancelEditDelivery(id){
  const ro=document.getElementById('delivery-readonly-'+id);
  const ed=document.getElementById('delivery-edit-'+id);
  if(ro)ro.style.display='block';
  if(ed)ed.style.display='none';
}
/* =========================================================
   采购订单 - 新建/编辑
   ========================================================= */
// 使用 router.js 声明的全局变量 _fItems
// 使用 router.js 声明的全局变量 _fMode
// 使用 router.js 声明的全局变量 _fOrderId
/** 初始化新建采购订单流程（含草稿恢复检测） */
function newOrder(){
  _fMode='new';_fOrderId=null;_fItems=[];
  _draftOrder=null;
  curOrder='__new__';curOrderView=null;
  if(typeof updateHash==='function')updateHash();
  // 检查草稿恢复（提前加载，后续 render() 读取 _draftOrder 回填）
  const savedDraft=hasDraft(DRAFT_TYPES.order)?loadDraft(DRAFT_TYPES.order):null;
  if(savedDraft){
    const ts=savedDraft._ts?new Date(savedDraft._ts).toLocaleString('zh-CN'):'';
    let msg='检测到未提交的「采购订单」草稿（'+ts+'，含'+((savedDraft.items&&savedDraft.items.length)||0)+'项产品），是否恢复？';
    if(savedDraft._appVersion&&savedDraft._appVersion!==APP_VERSION){msg+='\n\n⚠ 草稿版本为 '+savedDraft._appVersion+'，当前系统版本为 '+APP_VERSION+'，字段可能不兼容，恢复后请检查。';}
    confirmModal(msg,
      ()=>{
        _draftOrder=savedDraft;
        _fItems=savedDraft.items?savedDraft.items.map(function(it){return {...it};}):[];
        clearDraft(DRAFT_TYPES.order);
        render();
        setTimeout(bindOrderDraftSave,200);
        closeModal();toast('草稿已恢复','success');
      },
      '恢复草稿','放弃草稿',
      ()=>{
        clearDraft(DRAFT_TYPES.order);
        render();
        setTimeout(bindOrderDraftSave,200);
        toast('草稿已清除','info');
      }
    );
  } else {
    render();
    setTimeout(bindOrderDraftSave,200);
  }
}
/** 进入指定采购订单的编辑模式（仅「完成」状态锁定只读；其余状态均允许编辑） */
function goOrderEdit(id){
  const o=DB.orders.find(x=>x.id===id);
  if(!o)return;
  if(o.status==='完成'){
    toast('订单已完成，信息已锁定只读，不可编辑','warning');
    return;
  }
  _fMode='edit';_fOrderId=id;
  _draftOrder=null;
  _fItems=o.items.map(it=>({...it}));
  curOrder=id;curOrderView=null;
  render();
  // 编辑模式也绑定自动保存
  setTimeout(bindOrderDraftSave,100);
}
/** 一键复制订单：任意状态订单复制为新订单（待确认），保留客户/对接人/项目/产品明细及供应商分配与报价 */
function copyOrder(id){
  const src=DB.orders.find(x=>x.id===id);
  if(!src){toast('订单不存在','error');return;}
  confirmModal(
    '确认复制订单 '+src.id+'？<br><span class="muted" style="font-size:12px">将生成新的「待确认」订单，保留客户/对接人/项目/产品明细（规格/数量/意向价）及供应商分配与报价；复制后可在编辑中按需删除供应商分配或调整报价。</span>',
    function(){
      DB.orderSeq=(DB.orderSeq||1);
      const seq=DB.orderSeq;
      DB.orderSeq=seq+1;
      const newId='PO'+today().slice(2,4)+today().slice(5,7)+today().slice(8,10)+'-'+String(seq).padStart(3,'0');
      const o={
        id:newId,
        buyerId:src.buyerId,
        buyerContact:src.buyerContact,
        project:src.project,
        delivery:src.delivery,
        status:'待确认',
        remark:(src.remark?src.remark+' ':'')+'（复制自 '+src.id+'）',
        items:src.items.map(it=>({...it,options:(it.options||[]).map(x=>({...x}))})),
        createdAt:now(),
        _copiedFrom:src.id
      };
      DB.orders.push(o);
      saveDB();
      closeModal();
      toast('已复制为新订单：'+newId+'（待确认）','success');
      curOrder=null;curOrderView=newId;
      if(typeof updateHash==='function')updateHash();
      render();
    },
    '确认复制',
    null,null,
    true
  );
}
/** 从订单详情页进入指定产品行的寻货流程
 *  B1 修复：不再把详情模式的数据偷偷写入 _fOrderId + _fMode='edit'，改为显式 ctx 模式，
 *  避免与编辑模式变量冲突、避免后续"保存订单"按钮把详情页里临时 _fItems 误当编辑草稿。
 */
function sourceItemFromDetail(itemIdx){
  const o=DB.orders.find(x=>x.id===curOrderView);
  if(!o)return;
  sourceItem(itemIdx,'detail');
}
/**
 *  B1 修复：寻货结果统一写回（单入口）。
 *  - 详情模式（sourceItem(mode='detail')）：把 _fItems 深拷贝写回 DB 中该订单详情，即时 saveDB；
 *  - 编辑模式（mode==='edit' 或 缺省兼容）：更新 _fOrderId 指向的编辑订单行，防抖写入 DB。
 *  无论哪种模式，草稿缓存都同步清理或更新；UI 刷新也由本函数统一触发，防止 4 处调用点各自少调一项。
 * @param {{refreshEdit?:boolean}} [opts] refreshEdit=true 时即使不是编辑模式，也再调一次 refreshProductList（兜底）
 */
function persistSourcingChange(opts){
  opts=opts||{};
  // 详情模式：_fItems 已被 sourceItem 设为 DB 订单的浅拷贝。一次性落库。
  const isDetailMode=(_sourcingCtx&&_sourcingCtx.mode==='detail')||(curOrderView&&(!_fMode||_fMode==='__detail__'));
  const isEditMode=!isDetailMode&&_fMode==='edit'&&_fOrderId;
  if(isDetailMode){
    const o=DB.orders.find(x=>x.id===curOrderView);
    if(o){
      o.items=_fItems.map(it=>({...it,options:(it.options||[]).map(x=>({...x}))}));
      o.updatedAt=now();
      clearDraft(DRAFT_TYPES.order);
      saveDB();
    }
  }else if(isEditMode){
    const o=DB.orders.find(x=>x.id===_fOrderId);
    if(o){
      o.items=_fItems;
      o.updatedAt=now();
      saveDBDebounced();
      saveOrderDraftFromItems();
    }
  }
  // 统一 UI 刷新：详情侧行 + 汇总；编辑侧产品卡；抽屉内容
  if(curOrderView){updateDetailRow(_sourcingCtx?_sourcingCtx.lastIdx:undefined);refreshDetailStats();}
  if(_fMode==='edit')refreshProductList();
  if(typeof refreshSourceDrawer==='function'&&opts.idx!==undefined)refreshSourceDrawer(opts.idx);
}
/** 将寻货结果从临时状态持久化到订单详情数据（B1 修复：兼容遗留调用，单测 / 老扩展可继续调用） */
function persistSourcingFromDetail(){
  persistSourcingChange();
}
/** 将当前编辑中的产品明细防抖写入 DB（兼容遗留调用） */
function persistOrderItems(){
  persistSourcingChange();
}
/* 订单表单草稿自动保存 */
/** 为订单编辑表单绑定自动草稿保存事件 */
function bindOrderDraftSave(){
  const card=document.querySelector('#app .card');
  if(!card)return;
  // 草稿保存 300ms 防抖，避免输入过程中频繁写入 localStorage
  const handler=debounce(()=>{const d=collectOrderDraft();if(d)saveDraft(DRAFT_TYPES.order,d);},300);
  document.querySelectorAll('#app input,#app select,#app textarea').forEach(el=>{
    if(el.id&&el.id.startsWith('tf_')){el.addEventListener('input',handler);el.addEventListener('change',handler);}
  });
}
/** 手动触发订单草稿收集并保存 */
function saveOrderDraftFromItems(){
  if(_fMode==='new'||_fMode==='edit'){
    const d=collectOrderDraft();
    if(d)saveDraft(DRAFT_TYPES.order,d);
  }
}
/** 渲染当前编辑中的产品明细列表 HTML（含寻源状态条和供应商分配详情） */
/**
 * 渲染产品明细列表HTML（核心渲染函数）
 * 数据流：_fItems数组 → DOM卡片
 * 
 * 每个产品行包含：
 * - 基本信息：SKU/名称、规格、属性标签、需求数量、意向价、报价
 * - 寻源状态：已分配数量、剩余数量、进度条、状态标签（待寻源/部分寻源/已确认）
 * - 已选供应商：采购价、分配数量、利润、总金额、来源标记（价格库/手动）
 * - 操作按钮：编辑、寻货/管理供应商、删除
 * 
 * @returns {string} HTML字符串，直接插入 productCard 容器
 */
function renderItemHTML(){
  return _fItems.map((it,i)=>{
    const opts=itemOpts(it);           // 已选供应商列表
    const allocSum=itemAllocSum(it);   // 已分配总数量
    const [srcTxt,srcCls]=itemSourcingStatus(it);  // 寻源状态标签 [文本, CSS类名]
    const remain=it.qty-allocSum;      // 剩余未分配数量
    const pct=it.qty>0?Math.min(100,Math.round(allocSum/it.qty*100)):0;  // 分配百分比（上限100%）
    const srcBar='<div class="ir-alloc-bar"><div class="ir-alloc-fill '+(!opts.length?'empty':(allocSum>=it.qty?'':'partial'))+'" style="width:'+pct+'%"></div></div>';
    const sourcesHTML=opts.length?'<div class="ir-sources">'+
      opts.map(o=>{
        const lp=(itemQuotePrice(it)-(o.price||0))*(o.allocQty||0);
        return '<div class="ir-src '+(allocSum<it.qty?'partial':'')+'">'+
          '<span class="ir-src-name">'+contactTooltip(o.supplierId)+'</span>'+
          ' · 采购价 '+fmt(o.price)+
          ' · 分配 <span class="ir-src-qty">'+fmtN(o.allocQty)+'千支</span>'+
          ' · 利润 <span class="'+(lp>=0?'profit-pos':'profit-neg')+'">'+fmt(lp)+'</span>'+
          ' · 总金额: '+fmt((o.price||0)*(o.allocQty||0))+
          (o.source==='manual'?' <span class="tag purple">手动</span>':(o.source==='import'?' <span class="tag info">导入</span>':' <span class="tag info">价格库</span>'))+
          '<span class="ir-src-del" onclick="removeOption('+i+',\''+escJsStr(o.id)+'\')">×</span>'+
        '</div>';
      }).join('')+
    '</div>':'<div class="ir-unsourced">尚未匹配供应商，点击「寻货」从价格库选择或手动录入</div>';
    return '<div class="item-row">'+
      '<div class="ir-top">'+
        '<div>'+
          '<div class="ir-spec">'+escHtml(it.sku||it.name||'')+' · '+escHtml(it.spec||it.diameter||'')+'</div>'+
          '<div class="ir-meta">'+specTags(it)+'<br>需求: '+fmtN(it.qty)+'千支 · 已分配: '+fmtN(allocSum)+(remain>0?' · 剩余: '+fmtN(remain):'')+' · 意向价: '+fmt(it.salePrice)+(it.quotePrice>0?' · 报价: '+fmt(it.quotePrice):'')+(it.usage?' · 用途: '+escHtml(it.usage):'')+(it.remark?' · 备注: '+escHtml(it.remark):'')+'</div>'+
        '</div>'+
        '<div class="td-act">'+
          '<span class="tag '+srcCls+'" style="margin-right:4px">'+srcTxt+'</span>'+
          '<button class="btn sm" onclick="editItem('+i+')">'+icon('edit')+'编辑</button>'+
          '<button class="btn sm '+(opts.length&&remain<=0?'':'primary')+'" onclick="sourceItem('+i+')">'+(opts.length?(remain>0?icon('search')+'继续寻货':icon('building')+'管理供应商'):icon('search')+'寻货')+'</button>'+
          '<button class="btn sm danger" onclick="delItem('+i+')">'+icon('trash')+'</button>'+
        '</div>'+
      '</div>'+
      sourcesHTML+srcBar+
    '</div>';
  }).join('');
}
/**
 * 局部刷新产品明细卡片（避免全页重渲染）
 * 数据流：_fItems → DOM(#productCard) → 草稿保存 + 编辑模式持久化
 * 
 * 调用时机：
 * - 添加/编辑/删除产品后
 * - 寻源分配变更后
 * - 恢复草稿后
 */
function refreshProductList(){
  const card=document.getElementById('productCard');
  if(!card)return;
  card.innerHTML='<div style="display:flex;justify-content:space-between;align-items:flex-start">'+
      '<h2 style="margin:0">'+icon('tag','18')+'产品明细 <span class="tag info" id="itemCount">'+_fItems.length+'</span> 项</h2>'+
      '<div class="btn-group">'+
        '<button class="btn primary" onclick="addItem()">'+icon('plus')+'添加产品</button>'+
        '<button class="btn primary dropdown-toggle" onclick="toggleOrderItemDropdown(event)" title="更多操作">'+icon('chevronDown','14')+'</button>'+
        '<div class="dropdown-menu" id="orderItemDropdown" style="display:none">'+
          '<button class="dropdown-item" onclick="closeOrderItemDropdown();addItem()">'+icon('plus')+'添加产品</button>'+
          '<button class="dropdown-item" onclick="closeOrderItemDropdown();openOrderBatchAdd()">'+icon('fileText')+'批量添加</button>'+
        '</div>'+
      '</div>'+
    '</div>'+
    (renderItemHTML()||'<div class="empty">暂无产品明细，点击下方按钮添加</div>');
  saveOrderDraftFromItems();
  persistOrderItems();
}
/** 渲染采购订单编辑/新建表单视图 */
function viewOrderEdit(){
  const o=_fMode==='edit'?DB.orders.find(function(x){return x.id===_fOrderId;}):null;
  const d=_draftOrder;
  const buyerId=o?o.buyerId:(_draftOrder?_draftOrder.buyerId:'');
  const itemHTML=renderItemHTML();
  return '<div class="toolbar">'+
    '<button class="btn sm" onclick="go(\'orders\')">'+icon('arrowLeft')+'返回列表</button>'+
    '<div class="spacer"></div>'+
    '<button class="btn primary" onclick="saveOrder()">'+icon('check')+'保存订单</button>'+
  '</div>'+
  '<div class="card">'+
    '<h2>'+icon('doc','18')+(_fMode==='edit'?'编辑订单':'新建订单')+'</h2>'+
    '<div class="grid2">'+
      '<div class="field"><label class="f">采购商 <span style="color:var(--red)">*</span></label><div id="tf_buyer" class="combo" data-val="'+escAttr(buyerId)+'"></div></div>'+
      '<div class="field"><label class="f">对接联系人</label><select id="tf_contact" tabindex="3"><option value="">（请先选择采购商）</option></select></div>'+
    '</div>'+
    '<div class="grid2">'+
      '<div class="field"><label class="f">项目背景</label><input id="tf_project" tabindex="4" value="'+escAttr(o?o.project:(d?d.project:''))+'" placeholder="项目描述或用途"></div>'+
      '<div class="field"><label class="f">期望交货期 <span style="color:var(--red)">*</span></label><input id="tf_delivery" type="date" tabindex="5" min="'+today()+'" value="'+escAttr(o?fmtDelivery(o.delivery):(d&&d.delivery?d.delivery:today()))+'"></div>'+
    '</div>'+
    '<div class="grid2">'+
      '<div class="field"><label class="f">订单状态</label><select id="tf_status" tabindex="6">'+ORDER_STATUSES.filter(s=>s!=='未成交'||(o&&o.status==='未成交')).map(s=>'<option value="'+s+'" '+((o?o.status:(d?d.status:'待确认'))===s?'selected':'')+'>'+s+'</option>').join('')+'</select></div>'+
      '<div class="field"><label class="f">订单备注</label><input id="tf_remark" tabindex="7" value="'+escAttr(o?o.remark:(d?d.remark:''))+'" placeholder="备注信息"></div>'+
    '</div>'+
  '</div>'+
  '<div class="card" id="productCard">'+
    '<div style="display:flex;justify-content:space-between;align-items:flex-start">'+
      '<h2 style="margin:0">'+icon('tag','18')+'产品明细 <span class="tag info" id="itemCount">'+_fItems.length+'</span> 项</h2>'+
      '<div class="btn-group">'+
        '<button class="btn primary" onclick="addItem()">'+icon('plus')+'添加产品</button>'+
        '<button class="btn primary dropdown-toggle" onclick="toggleOrderItemDropdown(event)" title="更多操作">'+icon('chevronDown','14')+'</button>'+
        '<div class="dropdown-menu" id="orderItemDropdown" style="display:none">'+
          '<button class="dropdown-item" onclick="closeOrderItemDropdown();addItem()">'+icon('plus')+'添加产品</button>'+
          '<button class="dropdown-item" onclick="closeOrderItemDropdown();openOrderBatchAdd()">'+icon('fileText')+'批量添加</button>'+
        '</div>'+
      '</div>'+
    '</div>'+
    (itemHTML||'<div class="empty">暂无产品明细，点击下方按钮添加</div>')+
  '</div>';
}
/* ---- 产品添加/编辑 ---- */
window._fEditIdx=-1;
/** 订单保存中锁，防止重复点击导致多次提交（防重） */
let _orderSaving=false;
/** 产品新增/编辑弹窗保存锁（防重） */
let _itemSaving=false;
/** 手动录入供应商提交锁（防重） */
let _manualSupSaving=false;
/** 批量粘贴订单数据提交锁（防重） */
let _batchOrderSaving=false;
/** 批量导入供应商报价提交锁（防重） */
let _supplierQuoteSaving=false;
/**
 * 打开新增产品弹窗
 * @param {void}
 * @returns {void}
 */
function addItem(){_fEditIdx=-1;openItemModal(-1);}
/**
 * 打开编辑指定产品弹窗
 * @param {number} i - _fItems 数组索引
 * @returns {void}
 */
function editItem(i){_fEditIdx=i;openItemModal(i);}
/**
 * 确认后删除指定产品明细行
 * @param {number} i - _fItems 数组索引
 * @returns {void}
 */
function delItem(i){
  confirmModal('确认删除该产品明细?',()=>{
    _fItems.splice(i,1);
    closeModal();refreshProductList();
    toast('产品已删除','info');
  },'确认删除');
}
/** 打开产品新增/编辑抽屉面板（含 BOM 引用下拉） */
function openItemModal(idx){
  const it=idx>=0?_fItems[idx]:{type:'',standard:'',diameter:'',hardness:'',surface:'',material:'',spec:'',qty:'',salePrice:'',quotePrice:'',usage:'',remark:''};
  // 旧数据恢复：若无bomSku但spec能匹配到已录入BOM，自动补上关联
  if(idx>=0&&!it.bomSku&&it.spec){
    const match=DB.bom.find(b=>b.spec===it.spec);
    if(match){it.bomSku=match.sku;_fItems[idx].bomSku=match.sku;}
  }
  const body=document.createElement('div');
  body.innerHTML='<div class="field" style="margin-bottom:10px"><label class="f">BOM引用 <span style="color:var(--accent);font-size:11px">（选择后自动填入SKU与下方属性）</span></label><div id="m_bom_ref" class="combo" data-placeholder="搜索BOM..." data-val="'+escAttr(it.bomSku||'')+'"></div></div>'+
  '<div class="grid2" style="gap:12px;margin-bottom:10px">'+
    '<div class="field" style="margin:0"><label class="f">SKU</label><input id="m_sku" tabindex="10" value="'+escAttr(it.sku||'')+'" placeholder="选择BOM后自动填入"></div>'+
    '<div class="field" style="margin:0"><label class="f">规格</label><input id="m_spec" tabindex="11" value="'+escAttr(it.spec||'')+'" placeholder="选择BOM后自动填入"></div>'+
  '</div>'+
  '<div class="grid2" style="gap:12px">'+
    '<div class="field" style="margin:0"><label class="f">类型</label><div id="m_type" class="combo" data-placeholder="选择类型..." data-val="'+escAttr(it.type||'')+'"></div></div>'+
    '<div class="field" style="margin:0"><label class="f">标准</label><div id="m_standard" class="combo" data-placeholder="选择标准..." data-val="'+escAttr(it.standard||'')+'"></div></div>'+
    '<div class="field" style="margin:0"><label class="f">直径</label><div id="m_diameter" class="combo" data-placeholder="选择直径..." data-val="'+escAttr(it.diameter||'')+'"></div></div>'+
    '<div class="field" style="margin:0"><label class="f">材质</label><div id="m_material" class="combo" data-placeholder="选择材质..." data-val="'+escAttr(it.material||'')+'"></div></div>'+
    '<div class="field" style="margin:0"><label class="f">硬度</label><div id="m_hardness" class="combo" data-placeholder="选择硬度..." data-val="'+escAttr(it.hardness||'')+'"></div></div>'+
    '<div class="field" style="margin:0"><label class="f">表面处理</label><div id="m_surface" class="combo" data-placeholder="选择表面处理..." data-val="'+escAttr(it.surface||'')+'"></div></div>'+
  '</div>'+
  '<div class="grid2" style="gap:12px;margin-top:12px">'+
    '<div class="field" style="margin:0"><label class="f">数量(千支)<span style="color:var(--red)">*</span></label><input id="m_qty" type="number" tabindex="12" value="'+escAttr(it.qty||'')+'" placeholder="如：5000"></div>'+
    '<div class="field" style="margin:0"><label class="f">意向价格(元/千支)</label><input id="m_salePrice" type="number" tabindex="13" step="0.01" value="'+escAttr(it.salePrice||'')+'" placeholder="初期采购意向，可留空"></div>'+
  '</div>'+
  '<div class="field" style="margin-top:12px"><label class="f">报价(元/千支)</label><input id="m_quotePrice" type="number" tabindex="14" step="0.01" value="'+escAttr(it.quotePrice||'')+'" placeholder="供应商报价后，报给采购商的最终价格"></div>'+
  '<div class="field" style="margin-top:12px"><label class="f">用途</label><input id="m_usage" tabindex="15" value="'+escAttr(it.usage||'')+'" placeholder="如：设备装配"></div>'+
  '<div class="field" style="margin-top:12px"><label class="f">备注</label><input id="m_remark" tabindex="16" value="'+escAttr(it.remark||'')+'" placeholder="特殊要求等"></div>';
  openDrawer(idx>=0?'编辑产品':'添加产品',body.innerHTML,()=>saveItemModal(),true);
  setTimeout(()=>{
    // 绑定抽屉内容的 input/change 事件，标记未保存状态
    const bd=document.querySelector('.drawer-panel .drawer-bd');
    if(bd){bd.addEventListener('input',()=>markDrawerDirty());bd.addEventListener('change',()=>markDrawerDirty());}
    // BOM引用下拉
    const bomOpts=(DB.bom||[]).map(b=>({id:b.sku,label:b.sku+' · '+b.name+' · '+(b.spec||'')}));
    const bomRef=document.getElementById('m_bom_ref');
    if(bomRef){
      combo(bomRef,bomOpts,opt=>{
        bomRef.dataset.val=opt.id;
        fillSpecFromBOM('m');
      },'搜索BOM...',false);
    }
    SPEC_FIELDS.forEach(k=>{
      const el=document.getElementById('m_'+k);
      if(!el)return;
      combo(el,(DB.specs[k]||[]).map(v=>({id:v,label:v})),opt=>{el.dataset.val=opt.id;},SPEC_LABELS[k]+'(可直接输入)...',true);
    });
    if(bomRef && bomRef.dataset.val)fillSpecFromBOM('m');
  },50);
}
/** 保存产品弹窗数据到临时产品列表 */
function saveItemModal(){
  if(_itemSaving){toast('正在保存中，请稍候...','info');return;}
  _itemSaving=true;
  setTimeout(function(){_itemSaving=false;},500);
  const d={
    sku:document.getElementById('m_sku').value.trim(),
    type:getComboVal('m_type'),
    standard:getComboVal('m_standard'),
    diameter:getComboVal('m_diameter'),
    material:getComboVal('m_material'),
    hardness:getComboVal('m_hardness'),
    surface:getComboVal('m_surface'),
    spec:document.getElementById('m_spec').value.trim(),
    qty:+document.getElementById('m_qty').value,
    salePrice:+document.getElementById('m_salePrice').value,
    quotePrice:+document.getElementById('m_quotePrice').value,
    usage:document.getElementById('m_usage').value.trim(),
    remark:document.getElementById('m_remark').value.trim(),
    bomSku:document.getElementById('m_bom_ref').dataset.val||'',
  };
  // P3/R3 修复：数量校验统一走共享模块 FTValidators.isPositiveNumber（语义与原判定等价）
  if(!FTValidators.isPositiveNumber(d.qty)){toast('请填写有效数量','warning');return;}
  if(_fEditIdx>=0){
    const old=_fItems[_fEditIdx];
    _fItems[_fEditIdx]={...old,...d};
  }else{
    _fItems.push({id:uid('I'),...d,options:[]});
  }
  closeDrawer();refreshProductList();
  toast('产品已保存','success');
}
/* ---- 供应商寻货（多供应商分配） ---- */
/** 构建寻货抽屉面板的 HTML 内容 */
function buildSourceDrawerBody(idx){
  const it=_fItems[idx];
  const allocSum=itemAllocSum(it);
  const remain=it.qty-allocSum;
  const [srcTxt,srcCls]=itemSourcingStatus(it);
  const matched=DB.prices.filter(p=>specMatch(p,it));
  const existIds=itemOpts(it).map(o=>o.supplierId);
  const availMatched=matched.filter(p=>!existIds.includes(p.unitId));
  const curHTML=itemOpts(it).map(o=>{
    const lp=(itemQuotePrice(it)-(o.price||0))*(o.allocQty||0);
    return '<div class="src-current">'+
      contactTooltip(o.supplierId)+
      ' · 采购价 '+fmt(o.price)+' · 分配 <b>'+fmtN(o.allocQty)+'千支</b>'+
      ' · 利润 <span class="'+(lp>=0?'profit-pos':'profit-neg')+'">'+fmt(lp)+'</span>'+
      (o.source==='manual'?' <span class="tag purple">手动</span>':(o.source==='import'?' <span class="tag info">导入</span>':' <span class="tag info">价格库</span>'))+
      '<span class="sc-del" onclick="removeOption('+idx+',\''+escJsStr(o.id)+'\')">×</span>'+
    '</div>';
  }).join('');
  return '<div style="margin-bottom:16px;padding:14px;background:var(--bg-tint);border-radius:8px;border:1px solid var(--line)">'+
    '<div style="font-size:15px;font-weight:700;margin-bottom:8px">'+escHtml(it.sku||it.name||'')+' <span style="font-size:13px;color:var(--accent);font-weight:400">'+escHtml(it.spec||'')+'</span></div>'+
    '<div class="spec-line" style="margin-bottom:6px">'+specTags(it)+'</div>'+
    '<div style="display:flex;gap:20px;flex-wrap:wrap;font-size:14px;align-items:center">'+
      '<span>需求: <b>'+fmtN(it.qty)+'</b></span>'+
      '<span>已分配: <b style="color:var(--green)">'+fmtN(allocSum)+'</b></span>'+
      '<span>剩余: <b style="color:'+(remain>0?'var(--amber)':'var(--green)')+'">'+fmtN(remain)+'</b></span>'+
      '<span>意向价: '+fmt(it.salePrice)+(it.quotePrice>0?' · 报价: '+fmt(it.quotePrice):'')+'</span>'+
      '<span class="tag '+srcCls+'">'+srcTxt+'</span>'+
    '</div>'+
  '</div>'+
  (curHTML?'<div style="font-weight:600;margin-bottom:10px;font-size:14px">'+icon('check','16')+'已选供应商 ('+itemOpts(it).length+')</div><div style="margin-bottom:16px">'+curHTML+'</div>':'')+
  '<div style="border-top:2px solid var(--line);margin:16px 0;padding-top:16px;display:flex;gap:12px;flex-wrap:wrap">'+
    '<button class="btn primary" onclick="openPriceMatchModal('+idx+')">'+icon('search','16')+' 价格库匹配 ('+availMatched.length+')</button>'+
    '<button class="btn" onclick="openManualSupplierModal('+idx+')">'+icon('plus','16')+' 手动录入供应商</button>'+
  '</div>';
}
/** 构建价格库匹配弹窗的 HTML 内容（含搜索过滤） */
function buildPriceMatchModalBody(idx,q){
  const it=_fItems[idx];
  const allocSum=itemAllocSum(it);
  const remain=it.qty-allocSum;
  const matched=DB.prices.filter(p=>specMatch(p,it));
  const existIds=itemOpts(it).map(o=>o.supplierId);
  let availMatched=matched.filter(p=>!existIds.includes(p.unitId));
  const q2=(q||'').toLowerCase();
  if(q2)availMatched=availMatched.filter(p=>pName(p.unitId).toLowerCase().includes(q2)||(p.contact||'').toLowerCase().includes(q2));
  const listHTML=availMatched.length?availMatched.map(p=>{
    const unitProfit=itemQuotePrice(it)-p.price;
    return '<div class="src-modal-item">'+
      '<div class="smi-top">'+
        '<div><b>'+escHtml(pName(p.unitId))+'</b> <span class="tag '+(pRating(p.unitId)==='主力'?'ok':'gray')+'" style="font-size:12px">'+escHtml(pRating(p.unitId))+'</span></div>'+
        '<span class="smi-price">'+fmt(p.price)+'</span>'+
      '</div>'+
      '<div class="smi-meta">联系人: '+escHtml(p.contact||'-')+' · 有效期: '+escHtml(p.validFrom)+'</div>'+
      '<div style="margin-top:4px;font-size:14px" class="'+(unitProfit>=0?'profit-pos':'profit-neg')+'">单位利润 '+fmt(unitProfit)+'</div>'+
      '<div style="margin-top:8px;display:flex;align-items:center;gap:8px">'+
        '<input type="checkbox" id="pm_chk_'+p.id+'" value="'+p.id+'" style="width:16px;height:16px;cursor:pointer;accent-color:var(--green)">'+
        '<span class="muted" style="font-size:12px;white-space:nowrap">分配数量(千支):</span>'+
        '<input class="alloc-input" type="number" tabindex="31" id="alloc_'+p.id+'" data-val="'+Math.min(remain,it.qty)+'" value="'+Math.min(remain,it.qty)+'" min="1" max="'+remain+'" style="font-size:14px">'+
      '</div>'+
    '</div>';
  }).join(''):'<div class="empty" style="padding:20px">价格库中暂无匹配属性的报价（或已全部添加）</div>';
  return '<div class="search-box pm-search-box" style="max-width:100%;margin-bottom:12px">'+
    '<a href="javascript:void(0)" onclick="runPriceMatchFilter('+idx+')" style="text-decoration:none;color:inherit;cursor:pointer;display:flex;align-items:center">'+icon('search','16')+'</a>'+
    '<input id="pmSearch" tabindex="30" placeholder="搜索供应商名称或联系人（Enter 触发）..." onkeydown="if(event.key===\'Enter\'&&!event.isComposing)runPriceMatchFilter('+idx+')" autocomplete="off">'+
    '<span class="clear-btn" onclick="clearPriceMatchFilter('+idx+')">×</span>'+
  '</div>'+
    '<div style="font-size:14px;color:var(--gray);margin-bottom:8px">共 '+availMatched.length+' 条匹配</div>'+
    '<div id="pmList">'+listHTML+'</div>'+
    '<div id="pmEmpty" style="display:none" class="empty" style="padding:20px">价格库中暂无匹配属性的报价（或已全部添加）</div>';
}
/** 价格库匹配弹窗：执行搜索（§8 合规：Enter / 🔍 点击触发） */
function runPriceMatchFilter(idx){
  const el=document.getElementById('pmSearch');
  filterPriceMatchNow(idx,el?el.value:'');
}
/** 价格库匹配弹窗：清除搜索并恢复全部列表 */
function clearPriceMatchFilter(idx){
  const el=document.getElementById('pmSearch');
  if(el)el.value='';
  filterPriceMatchNow(idx,'');
}
/** 打开价格库匹配弹窗 */
function openPriceMatchModal(idx){
  const it=_fItems[idx];
  const body=document.createElement('div');
  body.innerHTML=buildPriceMatchModalBody(idx,'');
  modal('价格库匹配 · '+escHtml(it.diameter||'')+' '+escHtml(it.type||''),body,'确定',()=>submitPriceMatch(idx),true);
  setTimeout(()=>{const s=document.getElementById('pmSearch');if(s)s.focus();},100);
}
/** 提交价格库匹配勾选结果（批量添加供应商） */
function submitPriceMatch(idx){
  const chks=document.querySelectorAll('#pmList input[type="checkbox"]:checked');
  if(!chks.length){toast('请至少选择一个供应商','warning');return;}
  const it=_fItems[idx];
  const existIds=itemOpts(it).map(o=>o.supplierId);
  // 先收集勾选数据和分配数量，再关弹窗（弹窗关闭后 DOM 元素即销毁）
  const entries=Array.from(chks).map(chk=>{
    const priceId=chk.value;
    const qtyInput=document.getElementById('alloc_'+priceId);
    const qty=qtyInput?+qtyInput.value:(chk.dataset.val||+chk.dataset.qty||1);
    return {priceId,qty:qty>0?qty:1};
  });
  // 过滤掉已存在的供应商，汇总后一次性提示避免每个重复供应商都弹 toast
  const skipped=[];
  const filtered=entries.filter(e=>{
    const p=DB.prices.find(x=>x.id===e.priceId);
    if(!p)return false;
    if(existIds.includes(p.unitId)){skipped.push(pName(p.unitId));return false;}
    return true;
  });
  if(skipped.length)toast('⏭ 已跳过 '+skipped.length+' 个已添加供应商：'+skipped.slice(0,3).join('、')+(skipped.length>3?'...':''),'warning');
  if(!filtered.length){closeModal();return;}
  closeModal();
  filtered.forEach(e=>{
    addMatchSupplier(idx,e.priceId,e.qty);
  });
}
/** 按关键词过滤价格库匹配列表（保留已勾选状态）——核心逻辑 */
function filterPriceMatchNow(idx,q){
  const list=document.getElementById('pmList');
  if(!list)return;
  // 保留勾选状态，避免每字重绘丢失用户选择
  const checked={};
  list.querySelectorAll('input[type="checkbox"]:checked').forEach(cb=>{checked[cb.value]=true;});
  list.innerHTML=buildPriceMatchModalBody(idx,q);
  // 恢复勾选
  Object.keys(checked).forEach(id=>{
    const cb=document.getElementById('pm_chk_'+id);
    if(cb)cb.checked=true;
  });
}
/** 价格库匹配搜索防抖入口（对输入做 150ms 防抖，勾选状态保留由 filterPriceMatchNow 内部处理） */
const filterPriceMatch=debounce(filterPriceMatchNow,150);
/** 构建手动录入供应商弹窗的 HTML 内容 */
function buildManualSupplierModalBody(idx){
  const it=_fItems[idx];
  const remain=it.qty-itemAllocSum(it);
  return '<div style="margin-bottom:16px;padding:14px;background:var(--amber-l);border-radius:8px;border:1px solid var(--amber-line);font-size:14px">'+
    '<div style="font-weight:700;margin-bottom:6px">'+escHtml(it.sku||it.name||'')+' <span style="color:var(--accent);font-weight:400;font-size:13px">'+escHtml(it.spec||'')+'</span></div>'+
    '<div class="spec-line" style="margin-bottom:6px">'+specTags(it)+'</div>'+
    '<div class="field"><label class="f">供应商名称 <span style="color:var(--red)">*</span></label><div id="ms_name" class="combo" data-placeholder="搜索已有供应商或输入新名称..." data-val=""></div></div>'+
    '<div class="grid2">'+
      '<div class="field"><label class="f">联系人</label><input id="ms_contact" tabindex="40" placeholder="联系人姓名"></div>'+
      '<div class="field"><label class="f">联系电话</label><input id="ms_phone" tabindex="41" placeholder="联系电话"></div>'+
    '</div>'+
    '<div class="grid3">'+
      '<div class="field"><label class="f">采购单价(元/千支)<span style="color:var(--red)">*</span></label><input id="ms_price" type="number" step="0.01" tabindex="42" placeholder="0.00"></div>'+
      '<div class="field"><label class="f">分配数量(千支)<span style="color:var(--red)">*</span></label><input id="ms_qty" type="number" value="'+remain+'" min="1" max="'+remain+'" placeholder="本次分配数量"></div>'+
      '<div class="field"><label class="f">库存/交期备注</label><input id="ms_stock" tabindex="44" placeholder="如：现货 / 7天交"></div>'+
    '</div>'+
    '<div class="alert" id="msErr"></div>'+
    '<div style="margin-top:8px;font-size:12px;color:var(--gray)">自动写入价格库和关联单位</div>';
}
/** 打开手动录入供应商弹窗 */
function openManualSupplierModal(idx){
  const it=_fItems[idx];
  const body=document.createElement('div');
  body.innerHTML=buildManualSupplierModalBody(idx);
  modal('手动录入供应商 · '+escHtml(it.diameter||'')+' '+escHtml(it.type||''),body,'确定',()=>manualSupplier(idx),true);
  initSourceModalCombo();
}
/** 初始化寻货弹窗中的供应商 combo 组件 */
function initSourceModalCombo(){
  setTimeout(()=>{
    const nameEl=document.getElementById('ms_name');
    if(nameEl){
      combo(nameEl,DB.units.filter(u=>u.roles.includes('供应商')).map(u=>({id:u.id,label:u.name,tag:{text:u.rating,cls:u.rating==='主力'?'ok':(u.rating==='新客'?'warn':'gray')}})),
        opt=>{
          nameEl.dataset.val=opt.id;
          const u=DB.units.find(x=>x.id===opt.id);
          if(u){
            const c=u.contacts.find(c=>c.side==='供应商'||(c.sides&&c.sides.includes('供应')))||u.contacts[0];
            if(c){document.getElementById('ms_contact').value=c.name;document.getElementById('ms_phone').value=c.phone;}
          }
        },'搜索已有供应商或输入新名称...',true);
    }
  },50);
}
/** 刷新寻货抽屉面板内容 */
function refreshSourceDrawer(idx){
  const bd=document.querySelector('.drawer-wrap .drawer-bd');
  if(bd){
    bd.innerHTML=buildSourceDrawerBody(idx);
  }
}
/** 更新订单详情页中指定产品行的供应商和寻源状态 */
function updateDetailRow(idx){
  if(!curOrderView)return;
  const o=DB.orders.find(x=>x.id===curOrderView);
  if(!o||!o.items[idx])return;
  const it=o.items[idx];
  const profit=itemProfit(it);
  const allocSum=itemAllocSum(it);
  const [srcTxt,srcCls]=itemSourcingStatus(it);
  const opts=itemOpts(it);
  const row=document.getElementById('detail-row-'+idx);
  if(!row)return;
  const cells=row.querySelectorAll('td');
  if(cells.length<9)return;
  const supplierHTML=(opts.length?opts.map(o2=>{
    const lineProfit=(itemQuotePrice(it)-(o2.price||0))*(o2.allocQty||0);
    return '<div style="margin-bottom:4px;padding-bottom:4px;border-bottom:1px dashed var(--line)">'+
      contactTooltip(o2.supplierId)+
      ' · 采购价: '+fmt(o2.price)+' · 分配: <b>'+fmtN(o2.allocQty)+'千支</b>'+
      ' · 利润: <span class="'+(lineProfit>=0?'profit-pos':'profit-neg')+'">'+fmt(lineProfit)+'</span>'+
      ' · 总金额: '+fmt((o2.price||0)*(o2.allocQty||0))+
      (o2.source==='manual'?' <span class="tag purple">手动</span>':'')+
    '</div>';
  }).join(''):'<span class="tag warn">未寻货</span>')+
  (o.status==='寻货中'&&allocSum<it.qty?' <button class="btn sm primary" style="margin-top:4px" onclick="sourceItemFromDetail('+idx+')">'+icon('search')+'寻货</button>':'')+
  (allocSum>0&&allocSum>=it.qty&&o.status!=='完成'?' <button class="btn sm" style="margin-top:4px" onclick="sourceItemFromDetail('+idx+')">'+icon('building')+'管理供应商</button>':'');
  cells[6].innerHTML=supplierHTML;
  cells[7].innerHTML=opts.length?'<span class="tag '+srcCls+'">'+srcTxt+' '+fmtN(allocSum)+'/'+fmtN(it.qty)+'</span>':'<span class="tag gray">待寻源</span>';
  cells[8].innerHTML=opts.length?'<span class="'+(profit>=0?'profit-pos':'profit-neg')+'">'+fmt(profit)+'</span>':'-';
}
/** 刷新订单详情页顶部汇总统计（意向金额/报价总额/采购总成本/预估利润），寻货明细变更后实时联动 */
function refreshDetailStats(){
  if(!curOrderView)return;
  const o=DB.orders.find(x=>x.id===curOrderView);
  if(!o)return;
  const setStat=function(id,val){
    const el=document.getElementById(id);
    if(el)el.textContent=fmt(val);
  };
  setStat('st_intent',orderIntent(o));
  setStat('st_sales',orderSales(o));
  setStat('st_cost',orderCost(o));
  setStat('st_profit',orderProfit(o));
}
/**
 *  B1 修复：打开寻货抽屉（统一入口，不再依赖"详情页先改 _fMode 为 edit"的隐性副作用）。
 *  显式接收 mode 参数：
 *    - 'edit'   ：编辑/新建订单（_fMode='edit'|'new' 已在 viewOrderEdit 中设置，缺省兼容此路径）
 *    - 'detail' ：订单详情只读页（curOrderView 指定订单；_fItems 使用临时拷贝；写回通过 persistSourcingChange() 走 DB 直接更新）
 *  ctx 写入 _sourcingCtx 供后续 addMatchSupplier / manualSupplier / removeOption 决策持久化路径。
 * @param {number} idx - _fItems 数组索引
 * @param {'edit'|'detail'} [mode] - 选填：默认按现有 _fMode 推断；详情页 MUST 显式传 'detail'（sourceItemFromDetail 已处理）
 */
function sourceItem(idx,mode){
  // mode 推断 + ctx 持久化
  const inferred=(curOrderView&&_fMode!=='edit'&&_fMode!=='new')?'detail':'edit';
  const realMode=mode||inferred;
  const orderId=(realMode==='detail')?curOrderView:_fOrderId;
  if(realMode==='detail'){
    const o=DB.orders.find(x=>x.id===orderId);
    if(!o)return;
    // 详情模式：_fItems / _fMode 暂借使用，但显式标记 __detail__ 防止 persistSourcingChange 误判成编辑模式
    _fItems=o.items.map(it=>({...it,options:(it.options||[]).map(x=>({...x}))}));
    _fMode='__detail__';_fOrderId=null; // 清空 _fOrderId，避免任何"编辑模式写回"路径误命中
  }
  _sourcingCtx={mode:realMode,orderId:orderId||null,lastIdx:idx};
  const it=_fItems[idx];
  if(!it)return;
  const remain=it.qty-itemAllocSum(it);
  const body=buildSourceDrawerBody(idx);
  openDrawer('寻货 · '+escHtml(it.diameter||'')+' '+escHtml(it.type||'')+(remain>0?'（剩余 '+fmtN(remain)+' 待寻）':'（已满量）'),body,null,true,true);
}
/** 从价格库添加匹配的供应商到产品选项
 *  B1 修复：末尾调用统一的 persistSourcingChange({idx}) 替代双 persist + UI 刷新散列，
 *  保持 DB 操作时序：先本地内存变更（_fItems）→ 再统一写回 → 再重绘 UI。
 */
function addMatchSupplier(idx,priceId,q){
  const it=_fItems[idx];
  const p=DB.prices.find(x=>x.id===priceId);
  if(!p)return;
  // q 由 submitPriceMatch 预传；若未传则从 DOM 读取（兼容旧的单独添加路径）
  if(q===undefined) q=+document.getElementById('alloc_'+priceId).value;
  const allocSum=itemAllocSum(it);
  const remain=it.qty-allocSum;
  if(!FTValidators.isPositiveNumber(q)){toast('请输入有效分配数量','warning');return;}
  if(q>remain){toast('分配数量超出剩余量 '+fmtN(remain),'warning');return;}
  // 检查是否已存在该供应商
  if(itemOpts(it).some(o=>o.supplierId===p.unitId)){toast('供应商 '+pName(p.unitId)+' 已添加，若需更多数量请直接调整原分配数量，已跳过重复添加','warning');return;}
  it.options=it.options||[];
  it.options.push({id:uid('Q'),supplierId:p.unitId,contact:p.contact||'',price:p.price,allocQty:q,stockNote:'有效期:'+p.validFrom,source:'priceLibrary',status:'已选'});
  saveOrderDraftFromItems();
  persistSourcingChange({idx});
  toast('已添加供应商：'+pName(p.unitId)+' · 分配 '+fmtN(q),'success');
}
/** 提交手动录入的供应商数据（自动创建关联单位、同步价格库） */
function manualSupplier(idx){
  if(_manualSupSaving){toast('正在保存中，请稍候...','info');return;}
  _manualSupSaving=true;
  setTimeout(function(){_manualSupSaving=false;},500);
  const it=_fItems[idx];
  const nameVal=document.getElementById('ms_name').dataset.val;
  const nameInput=document.getElementById('ms_name').querySelector('input').value.trim();
  const name=nameVal&&nameVal!==nameInput?pName(nameVal):(nameVal||nameInput);
  const contact=document.getElementById('ms_contact').value.trim();
  const phone=document.getElementById('ms_phone').value.trim();
  const price=+document.getElementById('ms_price').value;
  const q=+document.getElementById('ms_qty').value;
  const stock=document.getElementById('ms_stock').value.trim();
  const errEl=document.getElementById('msErr');
  if(!name){errEl.style.display='block';errEl.textContent='请输入供应商名称';return;}
  if(!FTValidators.isPositiveNumber(price)){errEl.style.display='block';errEl.textContent='请输入有效采购单价';return;}
  if(!FTValidators.isPositiveNumber(q)){errEl.style.display='block';errEl.textContent='请输入有效分配数量';return;}
  const allocSum=itemAllocSum(it);
  if(allocSum+q>it.qty){errEl.style.display='block';errEl.textContent='累计分配数量超出需求 '+fmtN(it.qty)+'（已分配 '+fmtN(allocSum)+'）';return;}
  // 检查是否已存在该供应商
  if(itemOpts(it).some(o=>o.supplierId===nameVal||(pName(o.supplierId)===name))){errEl.style.display='block';errEl.textContent='该供应商已添加，请勿重复';return;}
  // 查找或创建关联单位
  let unit=DB.units.find(u=>u.name===name||(u.id===nameVal));
  if(!unit&&nameVal){
    unit=DB.units.find(u=>u.id===nameVal);
  }
  const isNewUnit=!unit;
  if(isNewUnit){
    unit={id:uid('U'),name,roles:['供应商'],sides:['供应'],term:'',rating:'新客',contacts:[]};
    if(contact||phone){
      unit.contacts.push({name:contact||'联系人',phone:phone||'',side:'供应',sides:['供应']});
    }
    DB.units.push(unit);
  } else {
    if(!unit.roles.includes('供应商')){
      unit.roles.push('供应商');
    }
    // 新增联系人或更新已有联系人（同名但不同电话则更新）
    if(contact){
      const exist=unit.contacts.find(c=>c.name===contact);
      if(exist){
        if(phone&&exist.phone!==phone){
          exist.phone=phone;  // 更新电话号码
        }
      }else{
        unit.contacts.push({name:contact,phone:phone||'',side:'供应',sides:['供应']});
      }
    }else if(phone){
      // 无姓名时，追加一个新联系人记录（避免电话相同则忽略）
      unit.contacts.push({name:'联系人',phone,side:'供应',sides:['供应']});
    }
  }
  // 自动写入价格库（防重复）
  const priceAttrs={type:it.type,standard:it.standard,diameter:it.diameter,hardness:it.hardness,surface:it.surface,material:it.material};
  const isNewPrice=!isPriceDuplicate(unit.id,it.bomSku||'',it.spec||'',priceAttrs,null);
  if(isNewPrice){
    DB.prices.push({
      id:uid('PR'),unitId:unit.id,contact:contact||'',
      type:it.type,standard:it.standard,diameter:it.diameter,
      hardness:it.hardness,surface:it.surface,material:it.material,
      spec:it.spec||'',bomSku:it.bomSku||'',
      price,validFrom:today(),remark:'订单寻货手动录入',source:'manual',createdAt:today()
    });
  }
  // toast 汇总：创建单位+更新角色+写入价格库+添加分配，一次性告知用户所有操作结果
  const msgs=[];
  if(isNewUnit)msgs.push('创建单位「'+name+'」');
  else if(!unit.roles.includes('供应商'))msgs.push('更新「'+name+'」角色为供应商');
  if(isNewPrice)msgs.push('同步价格库');
  msgs.push('添加供应商「'+name+'」· 分配 '+fmtN(q));
  saveDB();
  it.options=it.options||[];
  it.options.push({id:uid('Q'),supplierId:unit.id,contact:contact||'',price,allocQty:q,stockNote:stock,source:'manual',status:'已选'});
  saveOrderDraftFromItems();
  persistSourcingChange({idx});
  closeModal();
  toast(msgs.join('、'),'success');
}
/** 移除产品行中指定供应商的分配 */
function removeOption(idx,optId){
  const it=_fItems[idx];
  it.options=(it.options||[]).filter(o=>o.id!==optId);
  saveOrderDraftFromItems();
  persistSourcingChange({idx});
  toast('已移除该供应商分配','info');
}
/* ---- 保存订单 ---- */
/**
 * 保存订单（新建/编辑通用）
 * 数据流：DOM表单 → 数据校验 → DB.orders[+] → IndexedDB → 跳转列表
 * 
 * 校验规则：
 * - 必填：采购商、交货期、至少1个产品
 * - 产品必填：SKU或名称、数量；意向价与报价可选
 * 
 * 保存后动作：
 * - 清除草稿
 * - 清空 _fItems
 * - 跳转订单列表
 */
async function saveOrder(){
  if(_orderSaving){toast('正在保存中，请稍候...','info');return;}
  _orderSaving=true;
  try{
    const buyerId=document.getElementById('tf_buyer').dataset.val;
    const delivery=document.getElementById('tf_delivery').value;
    // P3/R3 修复：订单必填校验统一走共享模块 FTValidators.validateOrderInput
    // （buyerId → items → delivery 顺序与原实现一致，checkItem=false 维持视图层现状；消息文案不变）
    const _vr=FTValidators.validateOrderInput({buyerId:buyerId,delivery:delivery,items:_fItems},{checkItem:false});
    if(!_vr.ok){toast(_vr.error,'warning');return;}
    // 重复 SKU+规格 校验（仅警示不阻塞）
    const keyMap=new Map();
    _fItems.forEach((it,idx)=>{
      const k=(it.sku||'')+'#'+(it.spec||'');
      if(!k.trim()) return;
      if(!keyMap.has(k))keyMap.set(k,[]);
      keyMap.get(k).push(idx+1);
    });
    const dupGroups=[];
    keyMap.forEach((rows)=>{if(rows.length>1)dupGroups.push(rows);});
    if(dupGroups.length>0){
      const rowDescs=dupGroups.map(rows=>'第'+rows.join('/')+'条');
      let dupCount=0;dupGroups.forEach(rows=>dupCount+=rows.length);
      toast('⚠ 检测到 '+dupCount+' 条相同 SKU+规格 的产品行（'+rowDescs.join('；')+'），建议合并后再保存','warn');
    }
    const buyerContact=document.getElementById('tf_contact').value;
    const project=document.getElementById('tf_project').value;
    const status=document.getElementById('tf_status').value;
    if(!ORDER_STATUSES.includes(status)){toast('无效的订单状态','error');return;}
    const remark=document.getElementById('tf_remark').value;
    if(_fMode==='edit'&&_fOrderId){
      const o=DB.orders.find(x=>x.id===_fOrderId);
      if(o){
        if(status==='未成交'&&o.status!=='报价中'){
          // P3/R3 修复：视图层状态流转特判语义与共享模块 NEXT_STATUS['报价中'] 含 '未成交' 对齐（保持原提示文案）
          toast('未成交仅可从「报价中」订单进入，请先回到详情页标记','warning');return;
        }
        o.buyerId=buyerId;o.buyerContact=buyerContact;o.project=project;
        o.delivery=delivery;o.status=status;o.remark=remark;
        o.items=_fItems.map(it=>({...it,options:(it.options||[]).map(o=>({...o}))}));
        o.updatedAt=now();
        clearDraft(DRAFT_TYPES.order);
        await saveDB();
        toast('订单已保存','success');
        curOrder=null;curOrderView=_fOrderId;
        if(typeof updateHash==='function')updateHash();
        render();return;
      }
    }
    if(status==='未成交'){
      toast('未成交仅可从「报价中」订单标记进入，请先在详情页操作','warning');return;
    }
    // 使用 orderSeq 独立序号生成器，避免删除订单后序号重复
    DB.orderSeq=(DB.orderSeq||1);
    const seq=DB.orderSeq;
    DB.orderSeq=seq+1;
    const id='PO'+today().slice(2,4)+today().slice(5,7)+today().slice(8,10)+'-'+String(seq).padStart(3,'0');
    const o={id,buyerId,buyerContact,project,delivery,status,remark,items:_fItems.map(it=>({...it,options:(it.options||[]).map(o=>({...o}))})),createdAt:now()};
    DB.orders.push(o);
    clearDraft(DRAFT_TYPES.order);
    await saveDB();
    toast('订单已创建：'+id,'success');
    curOrder=null;curOrderView=id;
    if(typeof updateHash==='function')updateHash();
    render();
  } catch(e){
    toast('保存失败：'+e.message,'error');
  } finally {
    _orderSaving=false;
  }
}
/* ---- 采购订单批量添加 ---- */
/** 切换产品明细批量操作下拉菜单显隐 */
function toggleOrderItemDropdown(e){
  e.stopPropagation();
  let dd=document.getElementById('orderItemDropdown');
  if(!dd)return;
  let isOpen=dd.style.display==='block';
  dd.style.display=isOpen?'none':'block';
  if(!isOpen){
    setTimeout(function(){
      document.addEventListener('click',closeOrderItemDropdown,{once:true});
    },0);
  }
}
/** 关闭产品明细批量操作下拉菜单 */
function closeOrderItemDropdown(){
  let dd=document.getElementById('orderItemDropdown');
  if(dd)dd.style.display='none';
}
/** 打开批量添加产品从 Excel 粘贴的抽屉 */
function openOrderBatchAdd(){
  let html=
    '<div class="field">'+
      '<label class="f">从Excel粘贴数据</label>'+
      '<textarea id="orderBatchPaste" class="paste-area" tabindex="50" placeholder="从 Excel 复制数据后 Ctrl+V 粘贴到此&#10;支持列：SKU/名称、表面处理、规格、数量、单价&#10;首行如表头含关键词会自动跳过"></textarea>'+
      '<div class="note">按 Tab 分列，换行分行；序号列自动跳过</div>'+
    '</div>'+
    '<div style="margin-bottom:10px">'+
      '<button class="btn primary" onclick="parseOrderBatch()">'+icon('search')+'解析</button>'+
    '</div>'+
    '<div id="orderBatchPreview" class="batch-preview" style="display:none"></div>';
  openDrawer('批量添加产品',html,null,true,true);
}
/** 解析粘贴的 Excel 数据并预览（支持 BOM 自动匹配属性） */
function parseOrderBatch(){
  let raw=document.getElementById('orderBatchPaste').value;
  if(!raw.trim()){toast('请先粘贴数据','warning');return;}
  let lines=raw.split(/\r?\n/).filter(function(l){return l.trim();});
  if(!lines.length){toast('未检测到有效数据','warning');return;}
  let headerKeywords=['序号','名称','sku','规格','表面处理','数量','单价'];
  let allCols=lines[0].split('\t');
  let isHeader=false;
  for(let j=0;j<allCols.length;j++){
    let c=(allCols[j]||'').trim().toLowerCase();
    for(let k=0;k<headerKeywords.length;k++){
      if(c.indexOf(headerKeywords[k].toLowerCase())!==-1){isHeader=true;break;}
    }
    if(isHeader)break;
  }
  let dataLines=isHeader?lines.slice(1):lines;
  let extraFields=['standard','diameter','hardness','material'];
  let parsed=[];
  let errCount=0;
  for(let l=0;l<dataLines.length;l++){
    let cols=dataLines[l].split('\t');
    let firstColVal=(cols[0]||'').trim();
    let firstIsNum=/^\d+$/.test(firstColVal);
    let startIdx=firstIsNum?1:0;
    let valid=cols.slice(startIdx).filter(function(c){return c.trim();});
    if(valid.length===0)continue;
    let row={sku:'',name:'',spec:'',surface:'',qty:0,salePrice:0,standard:'',diameter:'',hardness:'',material:'',type:'',bomMatched:false};
    try{
      if(valid.length>=1){row.sku=valid[0].trim();row.name=row.sku;}
      if(valid.length>=2){row.surface=valid[1].trim();}
      if(valid.length>=3){row.spec=valid[2].trim();}
      if(valid.length>=4){let q=parseFloat(valid[3].trim());row.qty=isNaN(q)?0:q;}
      if(valid.length>=5){let p=parseFloat(valid[4].trim());row.salePrice=isNaN(p)?0:p;}
      for(let m=5;m<valid.length&&(m-5)<extraFields.length;m++){
        row[extraFields[m-5]]=valid[m].trim();
      }
      if(!row.sku){errCount++;continue;}
      let bom=_getBom(row.sku);
      if(bom){
        row.type=bom.type||'';
        row.standard=row.standard||bom.standard||'';
        row.diameter=row.diameter||bom.diameter||'';
        row.hardness=row.hardness||bom.hardness||'';
        row.material=row.material||bom.material||'';
        row.surface=row.surface||bom.surface||'';
        row.spec=row.spec||bom.spec||'';
        row.bomMatched=true;
      }
      parsed.push(row);
    }catch(e){errCount++;continue;}
  }
  if(!parsed.length){
    toast('解析失败，未识别到有效数据行','error');
    return;
  }
  let cols_=['编号','SKU','名称','规格','表面处理','数量','单价','金额','BOM状态'];
  let rowsHtml=parsed.map(function(r,i){
    return '<tr>'+
      '<td>'+(i+1)+'</td>'+
      '<td>'+escHtml(r.sku||'-')+'</td>'+
      '<td>'+escHtml(r.name||'-')+'</td>'+
      '<td>'+escHtml(r.spec||'-')+'</td>'+
      '<td>'+escHtml(r.surface||'-')+'</td>'+
      '<td>'+fmtN(r.qty)+'</td>'+
      '<td>'+fmt(r.salePrice)+'</td>'+
      '<td>'+fmt(r.qty*r.salePrice)+'</td>'+
      '<td><span class="tag '+(r.bomMatched?'ok':'warn')+'">'+(r.bomMatched?'已匹配':'未匹配')+'</span></td>'+
      '<td class="td-act"><button class="btn sm danger" onclick="removeOrderBatchRow('+i+')" title="删除行" aria-label="删除行">'+icon('x')+'</button></td>'+
    '</tr>';
  }).join('');
  let preview=document.getElementById('orderBatchPreview');
  preview.innerHTML=
    '<div class="table-wrap" style="max-height:300px;overflow-y:auto">'+
      '<table><thead><tr>'+
        cols_.map(function(c){return '<th>'+c+'</th>';}).join('')+'<th>操作</th>'+
      '</tr></thead><tbody>'+rowsHtml+'</tbody></table>'+
    '</div>'+
    '<div style="margin-top:12px;display:flex;justify-content:flex-end;gap:10px">'+
      '<button class="btn" onclick="closeDrawer()">取消</button>'+
      '<button class="btn primary" onclick="submitOrderBatch()">批量提交（'+parsed.length+' 条）</button>'+
    '</div>';
  preview.style.display='block';
  window._batchOrderData=parsed;
  if(errCount>0)toast('共 '+errCount+' 行解析失败已跳过','warning');
  else toast('解析完成，共 '+parsed.length+' 条','success');
}
/** 从批量解析预览中移除指定行 */
function removeOrderBatchRow(idx){
  if(!window._batchOrderData)return;
  window._batchOrderData.splice(idx,1);
  if(!window._batchOrderData.length){closeDrawer();toast('已清空所有数据','info');return;}
  let cols_=['编号','SKU','名称','规格','表面处理','数量','单价','金额','BOM状态'];
  let rowsHtml=window._batchOrderData.map(function(r,i){
    return '<tr>'+
      '<td>'+(i+1)+'</td>'+
      '<td>'+escHtml(r.sku||'-')+'</td>'+
      '<td>'+escHtml(r.name||'-')+'</td>'+
      '<td>'+escHtml(r.spec||'-')+'</td>'+
      '<td>'+escHtml(r.surface||'-')+'</td>'+
      '<td>'+fmtN(r.qty)+'</td>'+
      '<td>'+fmt(r.salePrice)+'</td>'+
      '<td>'+fmt(r.qty*r.salePrice)+'</td>'+
      '<td><span class="tag '+(r.bomMatched?'ok':'warn')+'">'+(r.bomMatched?'已匹配':'未匹配')+'</span></td>'+
      '<td class="td-act"><button class="btn sm danger" onclick="removeOrderBatchRow('+i+')" title="删除行" aria-label="删除行">'+icon('x')+'</button></td>'+
    '</tr>';
  }).join('');
  let preview=document.getElementById('orderBatchPreview');
  preview.innerHTML=
    '<div class="table-wrap" style="max-height:300px;overflow-y:auto">'+
      '<table><thead><tr>'+
        cols_.map(function(c){return '<th>'+c+'</th>';}).join('')+'<th>操作</th>'+
      '</tr></thead><tbody>'+rowsHtml+'</tbody></table>'+
    '</div>'+
    '<div style="margin-top:12px;display:flex;justify-content:flex-end;gap:10px">'+
      '<button class="btn" onclick="closeDrawer()">取消</button>'+
      '<button class="btn primary" onclick="submitOrderBatch()">批量提交（'+window._batchOrderData.length+' 条）</button>'+
    '</div>';
}
/** 提交批量解析数据到产品列表（含未匹配 SKU 一键加入 BOM） */
function submitOrderBatch(){
  if(_batchOrderSaving){toast('正在保存中，请稍候...','info');return;}
  _batchOrderSaving=true;
  setTimeout(function(){_batchOrderSaving=false;},500);
  let data=window._batchOrderData;
  if(!data||!data.length){toast('没有可提交的数据','warning');return;}
  let succ=0;
  let unmatched=[];
  for(let i=0;i<data.length;i++){
    let r=data[i];
    if(!r.sku||!(r.qty>0))continue;
    _fItems.push({
      id:uid('I'),
      type:r.type||'',
      standard:r.standard||'',
      diameter:r.diameter||'',
      material:r.material||'',
      hardness:r.hardness||'',
      surface:r.surface||'',
      spec:r.spec||'',
      sku:r.sku,
      name:r.name||r.sku,
      qty:r.qty,
      salePrice:r.salePrice||0,
      usage:'',
      remark:'',
      bomSku:r.bomMatched?r.sku:'',
      options:[]
    });
    succ++;
    if(!r.bomMatched)unmatched.push(r);
  }
  closeDrawer();
  refreshProductList();
  saveOrderDraftFromItems();
  persistOrderItems();
  if(unmatched.length){
    toast('成功添加 '+succ+' 项（'+unmatched.length+' 项BOM未匹配）','success');
    confirmModal('检测到 '+unmatched.length+' 个BOM库中不存在的SKU，是否一键添加到BOM库？',
      function(){
        DB.bom=DB.bom||[];
        for(let u=0;u<unmatched.length;u++){
          let r=unmatched[u];
          DB.bom.push({
            sku:r.sku,
            name:r.name||r.sku,
            spec:r.spec||'',
            type:r.type||'',
            standard:r.standard||'',
            diameter:r.diameter||'',
            hardness:r.hardness||'',
            surface:r.surface||'',
            material:r.material||''
          });
        }
        saveDB();
        closeModal();
        toast('已添加 '+unmatched.length+' 条到BOM库','success');
      },
      '添加到BOM库','取消',
      function(){closeModal();}
    );
  }else{
    toast('成功添加 '+succ+' 项产品','success');
  }
}
/* ---- 采购订单批量导入供应商报价 ---- */
/** 生成供应商检索下拉选项（复用关联单位中的供应商，支持搜索与输入新名称） */
function quoteSupplierComboOptions(){
  return DB.units.filter(u=>(u.roles||[]).includes('供应商')).map(u=>({id:u.id,label:u.name,tag:{text:u.rating,cls:u.rating==='主力'?'ok':(u.rating==='新客'?'warn':'gray')}}));
}
/** 打开批量导入供应商报价抽屉（从 Excel 粘贴） */
function openSupplierQuoteImport(){
  const html=
    '<div class="field">'+
      '<label class="f">从Excel粘贴供应商报价</label>'+
      '<textarea id="quotePaste" class="paste-area" tabindex="51" placeholder="从 Excel 复制数据后 Ctrl+V 粘贴到此&#10;支持列：序号 / 名称 / 表面处理 / 规格 / 数量（千支）/ 单价（元/千支）/ 金额（元）&#10;首行如表头含关键词会自动跳过"></textarea>'+
      '<div class="note">按 Tab 分列，换行分行；序号列自动跳过</div>'+
    '</div>'+
    '<div style="margin-bottom:10px">'+
      '<button class="btn primary" onclick="parseSupplierQuote()">'+icon('search')+'解析</button>'+
    '</div>'+
    '<div id="quotePreview" class="batch-preview" style="display:none"></div>';
  openDrawer('批量导入供应商报价',html,null,true,true);
}
/** 解析粘贴的 Excel 报价数据并预览（列：序号/名称/表面处理/规格/数量/单价/金额） */
function parseSupplierQuote(){
  const raw=document.getElementById('quotePaste').value;
  if(!raw.trim()){toast('请先粘贴数据','warning');return;}
  const lines=raw.split(/\r?\n/).filter(l=>l.trim());
  if(!lines.length){toast('未检测到有效数据','warning');return;}
  const headerKeywords=['序号','名称','表面处理','规格','数量','单价','金额'];
  const firstCols=lines[0].split('\t').map(c=>(c||'').trim().toLowerCase());
  const isHeader=firstCols.some(c=>c&&headerKeywords.some(k=>c.indexOf(k)!==-1));
  const dataLines=isHeader?lines.slice(1):lines;
  const parsed=[];
  let errCount=0;
  for(const line of dataLines){
    const cols=line.split('\t');
    const startIdx=/^\d+$/.test((cols[0]||'').trim())?1:0;
    const name=(cols[startIdx]||'').trim();
    const surface=(cols[startIdx+1]||'').trim();
    const spec=(cols[startIdx+2]||'').trim();
    const qty=parseFloat((cols[startIdx+3]||'').trim());
    const price=parseFloat((cols[startIdx+4]||'').trim());
    const amount=parseFloat((cols[startIdx+5]||'').trim());
    if(!name){errCount++;continue;}
    parsed.push({name,surface,spec,qty:isNaN(qty)?0:qty,price:isNaN(price)?0:price,amount:isNaN(amount)?0:amount,supplierId:''});
  }
  if(!parsed.length){toast('解析失败，未识别到有效数据行','error');return;}
  window._quoteImportData=parsed;
  renderSupplierQuotePreview();
  if(errCount>0)toast('共 '+errCount+' 行解析失败已跳过','warning');
  else toast('解析完成，共 '+parsed.length+' 条','success');
}
/** 渲染报价导入预览表格（每行含供应商下拉） */
function renderSupplierQuotePreview(){
  const data=window._quoteImportData;
  if(!data)return;
  const preview=document.getElementById('quotePreview');
  const cols_=['序号','名称','表面处理','规格','数量(千支)','单价(元/千支)','金额(元)','供应商','操作'];
  const rowsHtml=data.map((r,i)=>{
    return '<tr>'+
      '<td>'+(i+1)+'</td>'+
      '<td>'+escHtml(r.name||'-')+'</td>'+
      '<td>'+escHtml(r.surface||'-')+'</td>'+
      '<td>'+escHtml(r.spec||'-')+'</td>'+
      '<td>'+fmtN(r.qty)+'</td>'+
      '<td>'+fmt(r.price)+'</td>'+
      '<td>'+fmt(r.amount||(r.qty*r.price))+'</td>'+
      '<td><div id="qsup_'+i+'" class="combo" data-placeholder="搜索或输入供应商..." data-val="'+escAttr(r.supplierId||'')+'"></div></td>'+
      '<td class="td-act"><button class="btn sm danger" onclick="removeQuoteRow('+i+')" title="删除行" aria-label="删除行">'+icon('x')+'</button></td>'+
    '</tr>';
  }).join('');
  preview.innerHTML=
    '<div class="table-wrap" style="overflow:visible">'+
      '<table><thead><tr>'+cols_.map(c=>'<th>'+c+'</th>').join('')+'</tr></thead><tbody>'+rowsHtml+'</tbody></table>'+
    '</div>'+
    '<div style="margin-top:12px;display:flex;justify-content:flex-end;gap:10px">'+
      '<button class="btn" onclick="closeDrawer()">取消</button>'+
      '<button class="btn primary" onclick="submitSupplierQuote()">生成寻货结果（'+data.length+' 条）</button>'+
    '</div>';
  preview.style.display='block';
  initQuoteSupplierCombos();
}
/** 初始化报价预览各行供应商检索下拉（同手动录入供应商的搜索逻辑，避免公司过多无法下拉） */
function initQuoteSupplierCombos(){
  if(!window._quoteImportData)return;
  const opts=quoteSupplierComboOptions();
  setTimeout(()=>{
    window._quoteImportData.forEach((r,i)=>{
      const el=document.getElementById('qsup_'+i);
      if(!el)return;
      combo(el,opts,opt=>{window._quoteImportData[i].supplierId=opt.id;},'搜索或输入供应商...',true);
    });
  },50);
}
/** 从报价预览中移除指定行 */
function removeQuoteRow(idx){
  if(!window._quoteImportData)return;
  window._quoteImportData.splice(idx,1);
  if(!window._quoteImportData.length){closeDrawer();toast('已清空所有数据','info');return;}
  renderSupplierQuotePreview();
}
/** 按名称/规格匹配订单产品行 */
function findQuoteItemIndex(items,r){
  const name=(r.name||'').trim();
  const spec=(r.spec||'').trim();
  let idx=items.findIndex(it=>((it.sku||'').trim()===name)||((it.name||'').trim()===name));
  if(idx>=0)return idx;
  if(spec){
    idx=items.findIndex(it=>{
      const n=(it.sku||it.name||'').trim();
      const s=(it.spec||'').trim();
      return n===name&&s===spec;
    });
    if(idx>=0)return idx;
  }
  idx=items.findIndex(it=>{
    const n=(it.sku||it.name||'').trim();
    if(!n||!name)return false;
    return n.indexOf(name)>=0||name.indexOf(n)>=0;
  });
  return idx;
}
/** 提交报价数据，按匹配结果生成寻货结果（写入订单产品选项） */
function submitSupplierQuote(){
  if(_supplierQuoteSaving){toast('正在保存中，请稍候...','info');return;}
  _supplierQuoteSaving=true;
  setTimeout(function(){_supplierQuoteSaving=false;},500);
  const data=window._quoteImportData;
  if(!data||!data.length){toast('没有可提交的数据','warning');return;}
  const o=DB.orders.find(x=>x.id===curOrderView);
  if(!o){toast('订单不存在','error');return;}
  const missing=data.filter(r=>!r.supplierId);
  if(missing.length){toast('有 '+missing.length+' 行未选择供应商','warning');return;}
  let matched=0,unmatched=0,skipped=0;
  const unmatchedNames=[];
  for(const r of data){
    const idx=findQuoteItemIndex(o.items,r);
    if(idx<0){unmatched++;if(unmatchedNames.length<3)unmatchedNames.push(r.name);continue;}
    const it=o.items[idx];
    let u=DB.units.find(x=>x.id===r.supplierId);
    if(!u){u=DB.units.find(x=>x.name===r.supplierId);}
    if(!u){u={id:uid('U'),name:r.supplierId,roles:['供应商'],sides:['供应'],term:'',rating:'新客',contacts:[]};DB.units.push(u);}
    if(itemOpts(it).some(opt=>opt.supplierId===u.id)){skipped++;continue;}
    const remain=it.qty-itemAllocSum(it);
    let q=r.qty;
    if(!FTValidators.isPositiveNumber(q)){skipped++;continue;}
    if(q>remain){q=remain;}
    if(q<=0){skipped++;continue;}
    const contact=(u.contacts&&u.contacts.length)?(u.contacts[0].name||''):'';
    it.options=it.options||[];
    it.options.push({id:uid('Q'),supplierId:u.id,contact,price:r.price,allocQty:q,stockNote:'批量导入',source:'import',status:'已选'});
    matched++;
  }
  o.updatedAt=now();
  clearDraft(DRAFT_TYPES.order);
  saveDB();
  closeDrawer();
  render();
  if(unmatched){
    toast('已生成 '+matched+' 条寻货结果，'+unmatched+' 行未匹配到产品（'+unmatchedNames.join('、')+'等）'+(skipped?'，'+skipped+' 行跳过':''),'warning');
  }else{
    toast('已生成 '+matched+' 条寻货结果'+(skipped?'，'+skipped+' 行跳过':''),'success');
  }
}
/* ---- 采购订单生成报价 ---- */
/** 打开生成报价弹窗：逐产品填写报给采购商的最终报价（供应商报价后贸易商加利润） */
function openGenerateQuote(){
  const o=DB.orders.find(x=>x.id===curOrderView);
  if(!o||!o.items.length){toast('暂无产品可生成报价','warning');return;}
  const rows=o.items.map((it,i)=>{
    const cost=itemOpts(it).reduce((s,x)=>s+(x.price||0)*(x.allocQty||0),0);
    const def=it.quotePrice>0?it.quotePrice:(it.salePrice>0?it.salePrice:cost);
    return '<tr>'+
      '<td style="text-align:left">'+escHtml(it.sku||it.name||'')+'<div class="muted" style="font-size:11px">'+escHtml(it.spec||'')+'</div></td>'+
      '<td>'+fmtN(it.qty)+'</td>'+
      '<td>'+fmt(it.salePrice)+'</td>'+
      '<td>'+fmt(cost)+'</td>'+
      '<td><input id="gq_'+i+'" type="number" step="0.01" min="0" value="'+escAttr(def)+'" style="width:120px"></td>'+
    '</tr>';
  }).join('');
  const body='<div class="table-wrap" style="overflow:visible"><table><thead><tr><th>产品</th><th>数量(千支)</th><th>意向价</th><th>采购成本</th><th>报价(元/千支)</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '<div class="muted" style="font-size:12px;margin-top:8px">报价为报给采购商的最终价格，默认取意向价、无意向价时取采购成本，可手动调整。</div>';
  modal('生成报价',body,'保存报价',saveGeneratedQuote,true);
}
/** 保存生成报价弹窗中填写的报价到各产品行 */
function saveGeneratedQuote(){
  const o=DB.orders.find(x=>x.id===curOrderView);
  if(!o)return;
  o.items.forEach((it,i)=>{
    const el=document.getElementById('gq_'+i);
    if(el)it.quotePrice=parseFloat(el.value)||0;
  });
  o.updatedAt=now();
  saveDB();
  closeModal();
  render();
  toast('报价已生成','success');
}
/* ---- 采购订单收货管理 ---- */
/** 进入收货管理阶段（签约完成/送货中/完成）的订单状态集合 */
const RECEIVABLE_STATUSES=['签约完成','送货中','完成'];
/** 渲染收货管理栏目：在详情页以可编辑表格逐条维护各供应商寄出/收货信息；locked 为订单完成后只读 */
function receiveManageSection(o,locked){
  const rows=[];
  o.items.forEach(it=>{
    itemOpts(it).forEach(opt=>{rows.push({it,opt});});
  });
  if(!rows.length)return '';
  const body=rows.map(r=>{
    const opt=r.opt;
    const shipped=!!opt.shipped,received=!!opt.received;
    const dshp=(shipped&&!locked)?'':'disabled';
    const drcv=(received&&!locked)?'':'disabled';
    const yn=v=>v?'是':'否';
    const num=v=>(v>0?fmtN(v):'<span class="muted">-</span>');
    const dt=v=>(v?escHtml(v):'<span class="muted">-</span>');
    const fields=locked
      ? '<td>'+yn(shipped)+'</td>'+
        '<td>'+num(opt.shippedQty)+'</td>'+
        '<td>'+dt(opt.shippedDate)+'</td>'+
        '<td>'+yn(received)+'</td>'+
        '<td>'+num(opt.receivedQty)+'</td>'+
        '<td>'+dt(opt.receivedDate)+'</td>'
      : '<td><select id="rcv_shipped_'+opt.id+'" onchange="updateReceiveField(\''+opt.id+'\',\'shipped\',this.value===\'1\')"><option value="0"'+(shipped?'':' selected')+'>否</option><option value="1"'+(shipped?' selected':'')+'>是</option></select></td>'+
        '<td><input id="rcv_shippedQty_'+opt.id+'" type="number" min="0" step="0.01" value="'+escAttr(shipped?opt.shippedQty:'')+'" placeholder="'+fmtN(opt.allocQty)+'" '+dshp+' onchange="updateReceiveField(\''+opt.id+'\',\'shippedQty\',this.value)" style="width:88px"></td>'+
        '<td><input id="rcv_shippedDate_'+opt.id+'" type="date" value="'+escAttr(shipped?opt.shippedDate:'')+'" '+dshp+' onchange="updateReceiveField(\''+opt.id+'\',\'shippedDate\',this.value)" style="width:144px"></td>'+
        '<td><select id="rcv_received_'+opt.id+'" onchange="updateReceiveField(\''+opt.id+'\',\'received\',this.value===\'1\')"><option value="0"'+(received?'':' selected')+'>否</option><option value="1"'+(received?' selected':'')+'>是</option></select></td>'+
        '<td><input id="rcv_receivedQty_'+opt.id+'" type="number" min="0" step="0.01" value="'+escAttr(received?opt.receivedQty:'')+'" placeholder="'+fmtN(opt.allocQty)+'" '+drcv+' onchange="updateReceiveField(\''+opt.id+'\',\'receivedQty\',this.value)" style="width:88px"></td>'+
        '<td><input id="rcv_receivedDate_'+opt.id+'" type="date" value="'+escAttr(received?opt.receivedDate:'')+'" '+drcv+' onchange="updateReceiveField(\''+opt.id+'\',\'receivedDate\',this.value)" style="width:144px"></td>';
    return '<tr>'+
      '<td style="text-align:left">'+escHtml(r.it.sku||r.it.name||'')+'<div class="muted" style="font-size:11px">'+escHtml(r.it.spec||'')+'</div></td>'+
      '<td style="text-align:left">'+escHtml(pName(opt.supplierId))+(opt.contact?'<div class="muted" style="font-size:11px">'+escHtml(opt.contact)+'</div>':'')+'</td>'+
      '<td>'+fmtN(opt.allocQty)+'</td>'+
      fields+
    '</tr>';
  }).join('');
  return '<div style="margin-top:18px"><h3 style="font-size:15px;font-weight:600;margin-bottom:12px;display:flex;align-items:center;gap:8px">'+icon('package','16')+'收货管理'+(locked?' <span class="tag gray">🔒 已锁定</span>':'')+'</h3>'+
    '<div class="table-wrap"><table><thead><tr><th>产品</th><th>供应商</th><th>分配(千支)</th><th>是否寄出</th><th>寄出数量</th><th>寄出日期</th><th>是否收到</th><th>收到数量</th><th>收货日期</th></tr></thead><tbody>'+body+'</tbody></table></div>'+
    '<div class="muted" style="font-size:12px;margin-top:8px">寄出数量可按实际多填（如考虑包装损耗），数量与日期修改后即时保存。</div>'+
  '</div>';
}
/** 收货字段高频修改后的整页渲染防抖（150ms） */
const _receiveRenderDebounced=debounce(render,150);
/** 即时保存收货字段：切换「是/否」时自动填充数量，修改寄出数量时同步收到数量 */
function updateReceiveField(optId,field,value){
  const o=DB.orders.find(x=>x.id===curOrderView);
  if(!o)return;
  if(!['签约完成','送货中'].includes(o.status)){toast('仅「签约完成」或「送货中」状态可修改收货信息','warning');return;}
  let opt=null;
  for(const it of o.items){
    opt=(it.options||[]).find(x=>x.id===optId);
    if(opt)break;
  }
  if(!opt)return;
  const qShp=document.getElementById('rcv_shippedQty_'+optId);
  const dShp=document.getElementById('rcv_shippedDate_'+optId);
  const qRcv=document.getElementById('rcv_receivedQty_'+optId);
  const dRcv=document.getElementById('rcv_receivedDate_'+optId);
  if(field==='shipped'){
    opt.shipped=!!value;
    if(opt.shipped){
      if(!(opt.shippedQty>0)){opt.shippedQty=opt.allocQty||0;if(qShp)qShp.value=opt.shippedQty;}
    }else{
      opt.shippedQty=0;opt.shippedDate='';
      if(qShp)qShp.value='';
      if(dShp)dShp.value='';
    }
    if(qShp)qShp.disabled=!opt.shipped;
    if(dShp)dShp.disabled=!opt.shipped;
  }else if(field==='received'){
    opt.received=!!value;
    if(opt.received){
      if(!(opt.receivedQty>0)){
        opt.receivedQty=(opt.shippedQty>0?opt.shippedQty:(opt.allocQty||0));
        if(qRcv)qRcv.value=opt.receivedQty;
      }
    }else{
      opt.receivedQty=0;opt.receivedDate='';
      if(qRcv)qRcv.value='';
      if(dRcv)dRcv.value='';
    }
    if(qRcv)qRcv.disabled=!opt.received;
    if(dRcv)dRcv.disabled=!opt.received;
  }else if(field==='shippedQty'){
    opt.shippedQty=parseFloat(value)||0;
    if(opt.received){opt.receivedQty=opt.shippedQty;if(qRcv)qRcv.value=opt.receivedQty;}
  }else if(field==='receivedQty'){
    opt.receivedQty=parseFloat(value)||0;
  }else{
    opt[field]=value||'';
  }
  o.updatedAt=now();
  // 高频字段修改：索引库写入走全局防抖，整页渲染节流，避免连续操作卡顿
  saveDBDebounced();
  // 重新渲染整个页面，使验货提示区、收货管理表格、订单状态流程联动
  if(o.status==='签约完成'||o.status==='送货中'||o.status==='完成'){
    _receiveRenderDebounced();
  }
}
/* ---- 采购订单批量删除 ---- */
/** 确认后删除指定采购订单 */
function deleteOrder(id){
  confirmModal('确认删除该采购订单？单号: '+id,function(){
    softDelete('order',id,{operator:'user'});
    render();toast('已删除','info');
  },'确认删除');
}
/* ---- 联系人悬停气泡辅助函数 ---- */
/** 生成带悬停气泡的供应商名称：气泡内显示联系人、电话、微信 */
function contactTooltip(supplierId){
  const u=DB.units.find(x=>x.id===supplierId);
  if(!u)return escHtml(pName(supplierId));
  const name=escHtml(u.name);
  // 取第一个联系人
  const c=(u.contacts&&u.contacts.length)?u.contacts[0]:null;
  if(!c)return name;
  const phone=c.phone?escHtml(c.phone):'-';
  const wx=c.wechat?escHtml(c.wechat):'-';
  const contactName=escHtml(c.name||'');
  return '<span class="supplier-name-wrap"><b>'+name+'</b>'+(contactName?' · '+contactName:'')+
    '<span class="ctip"><b>'+name+'</b><br>联系人: '+contactName+'<br>电话: '+phone+'<br>微信: '+wx+'</span></span>';
}

/* ---- 验货完成提示区（签约完成状态） ---- */
/** 渲染验货完成提示区：全部收齐后显示引导进入送货的按钮 */
function renderInspectionSection(o){
  if(o.status!=='签约完成')return '';
  const rows=[];
  o.items.forEach(it=>{itemOpts(it).forEach(opt=>{rows.push(opt);});});
  if(!rows.length)return '';
  const total=rows.length;
  const received=rows.filter(o=>o.received).length;
  const allDone=received>=total;
  if(allDone){
    return '<div style="margin:16px 0;background:var(--green-l);border:1px solid var(--green-line);border-radius:8px;padding:16px">'+
      '<div style="display:flex;justify-content:space-between;align-items:center">'+
        '<div><b>'+icon('check','16')+' 验货完成</b><span class="muted" style="margin-left:8px;font-size:13px">全部 '+total+' 条供应商记录均已确认收货</span></div>'+
        '<span class="muted" style="font-size:12px">可在顶部工具栏点击「进入送货」</span>'+
      '</div>'+
    '</div>';
  }else{
    return '<div style="margin:16px 0;background:var(--amber-l);border:1px solid var(--amber-line);border-radius:8px;padding:16px">'+
      '<div style="display:flex;justify-content:space-between;align-items:center">'+
        '<div><b>'+icon('package','16')+' 验货进度</b><span class="muted" style="margin-left:8px;font-size:13px">已收到 '+received+' / '+total+' 条供应商记录，还差 '+(total-received)+' 条</span></div>'+
      '</div>'+
      '<div style="margin-top:8px;height:6px;background:var(--line);border-radius:3px;overflow:hidden"><div style="height:100%;width:'+Math.round(received/total*100)+'%;background:var(--green);border-radius:3px"></div></div>'+
    '</div>';
  }
}
/** 订单完成确认弹窗 */
function confirmOrderComplete(id){
  confirmModal('确认完成此订单？完成后所有信息将锁定只读。',function(){
    changeOrderStatus(id,'完成');
  },'确认完成');
}

/** 切换订单列表全选/取消全选 */
function toggleAllOrders(cb){
  document.querySelectorAll('.order-check').forEach(function(c){
    if(c.closest('tr').style.display!=='none')c.checked=cb.checked;
  });
  updateOrderBatchBtn();
}
/** 根据选中订单数量更新批量删除按钮状态 */
function updateOrderBatchBtn(){
  let checked=document.querySelectorAll('.order-check:checked');
  let btn=document.getElementById('orderBatchDelBtn');
  let cnt=document.getElementById('orderBatchCount');
  if(!btn)return;
  if(checked.length>0){
    btn.style.display='';btn.className='btn sm danger';cnt.textContent=checked.length;
  }else{
    btn.style.display='none';
  }
}
/** 批量删除选中的采购订单（含结算/发票关联检查提示） */
function batchDeleteOrders(){
  const checks=document.querySelectorAll('.order-check:checked');
  const ids=[];
  checks.forEach(function(c){ids.push(c.dataset.id);});
  // 结算与发票关联检查
  const settleRefs=[];
  const invRefs=[];
  ids.forEach(function(orderId){
    const order=DB.orders.find(o=>o.id===orderId);
    const oid=orderId;
    // 结算关联
    const sHit=(DB.settlements||[]).filter(s=>s.orders&&s.orders.some(so=>so.orderId===oid));
    if(sHit.length>0){
      const desc=(order?order.id+'(PO)':oid)+' 已生成 '+sHit.length+' 条结算记录';
      settleRefs.push(desc);
    }
    // 发票关联：通过 settleId 找结算再找订单 或 直接找 inv 上是否有 order 引用
    const invHit=(DB.invoices||[]).filter(inv=>{
      if(!inv.settleId)return false;
      const s=(DB.settlements||[]).find(x=>x.id===inv.settleId);
      return s&&s.orders&&s.orders.some(so=>so.orderId===oid);
    });
    if(invHit.length>0){
      const desc=(order?order.id+'(PO)':oid)+' 已生成 '+invHit.length+' 条发票记录';
      invRefs.push(desc);
    }
  });
  let msg='确认删除选中的 '+ids.length+' 条订单？';
  if(settleRefs.length>0||invRefs.length>0){
    const warns=[];
    if(settleRefs.length>0)warns.push('订单 '+settleRefs.join('；')+'，删除后结算数据将失配');
    if(invRefs.length>0)warns.push('订单 '+invRefs.join('；')+'，删除后发票数据将失配');
    msg='⚠ '+warns.join('\n')+'\n\n确认后仍将删除（不阻止，只提示）。\n\n'+msg;
  }
  confirmModal(msg,function(){
    const idSet=new Set(ids);
    const bid=uid('AOB');ids.forEach(function(id){try{softDelete('order',id,{operator:'user',batchId:bid});}catch(e){}});
    render();toast('已删除 '+ids.length+' 条','info');
  },'确认删除');
}