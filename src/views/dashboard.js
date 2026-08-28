// views/dashboard.js — 概览
/* =========================================================
   概览
   ========================================================= */
/**
 * 跳转到订单页并弹出今日待办汇总提示（逾期/临期/待处理分段统计）。
 * @returns {void} 无返回值
 */
function gotoPendingOrders(){
  go('orders');
  setTimeout(function(){
    const overdue=[], approaching=[], pendingRest=[];
    for(let i=0;i<DB.orders.length;i++){
      const o=DB.orders[i];
      const od=isOverdue(o);
      const ap=isApproaching(o);
      if(od){overdue.push(o);}
      else if(ap){approaching.push(o);}
      else if(['待确认','寻货中','报价中'].includes(o.status)){pendingRest.push(o);}
    }
    const pending={overdue:overdue.length,upcoming:approaching.length,process:pendingRest.length,total:overdue.length+approaching.length+pendingRest.length};
    window.scrollTo(0,0);
    toast('今日待办：逾期 '+pending.overdue+' 项、临期 '+pending.upcoming+' 项、待处理 '+pending.process+' 项，合计 '+pending.total+' 项。请在上方「订单状态」筛选中分段查看','info');
  }, 50);
}
/**
 * 渲染概览仪表盘（今日待办列表、统计卡片、利润横幅、最近订单表格）。
 * @returns {string} 概览页 HTML
 */
function viewDashboard(){
  // 单次遍历订单：同时收集 pending/overdue/approaching 和累计利润
  const overdue=[], approaching=[], pendingRest=[];
  let totalProfit=0, pendingCount=0;
  for(let i=0;i<DB.orders.length;i++){
    const o=DB.orders[i];
    const od=isOverdue(o);
    const ap=isApproaching(o);
    if(od){overdue.push(o);}
    else if(ap){approaching.push(o);}
    else if(['待确认','寻货中','报价中'].includes(o.status)){pendingRest.push(o);}
    if(o.status==='完成')totalProfit+=orderProfit(o);
  }
  const todayTasks=[...overdue,...approaching,...pendingRest];
  pendingCount=overdue.length+approaching.length+pendingRest.length;

  let todayHTML='';
  if(todayTasks.length){
    todayHTML='<div class="today-box">'+
      '<div class="th">'+icon('alert','20')+'今天要处理 <span style="font-size:13px;font-weight:400;color:var(--gray)">'+todayTasks.length+' 项</span></div>'+
      '<div class="today-list">'+
        todayTasks.slice(0,10).map(o=>{
          const od=isOverdue(o);
          const ap=isApproaching(o);
          let badge='';
          if(od){const d=daysUntil(o.delivery);badge='逾期'+Math.abs(d)+'天';}
          else if(ap){badge='距交期'+daysUntil(o.delivery)+'天';}
          else{badge=o.status;}
          return '<div class="today-item'+(od?' overdue':(ap?' approaching':''))+'" onclick="goOrder(\''+o.id+'\')" style="cursor:pointer">'+
            '<div class="ti-info">'+
              '<div class="ti-title">'+escHtml(o.id)+' · '+escHtml(pName(o.buyerId))+' · '+escHtml(o.project||'')+' <span class="badge-'+(od?'red':(ap?'amber':''))+'">'+escHtml(badge)+'</span></div>'+
              '<div class="ti-meta">交期 '+escHtml(fmtDelivery(o.delivery))+' · '+o.items.length+' 项产品 · 状态：'+escHtml(o.status)+'</div>'+
            '</div>'+
            '<button class="btn sm primary" onclick="event.stopPropagation();goOrder(\''+o.id+'\')">'+icon('chevronRight','14')+'处理</button>'+
          '</div>';
        }).join('')+
      '</div>'+
      (todayTasks.length>10?'<div style="text-align:center;padding:8px 0">'+
        '<a href="javascript:void(0)" onclick="gotoPendingOrders()" style="color:var(--blue);font-size:14px;text-decoration:none">查看全部 '+todayTasks.length+' 项待处理 →</a>'+
      '</div>':'')+
    '</div>';
  }else{
    // 空状态 — 无待办时的正向提示
    todayHTML='<div class="today-box">'+
      '<div class="th">'+icon('alert','20')+'今天要处理</div>'+
      '<div class="no-today">'+
        '<div style="font-size:32px;margin-bottom:8px">🎉</div>'+
        '<div style="font-size:15px;color:var(--ink)">暂无待处理事项</div>'+
        '<div style="font-size:13px;color:var(--gray);margin-top:4px">所有订单都在正常推进中</div>'+
      '</div>'+
    '</div>';
  }

  // 单次遍历单位：同时统计供应商和采购商
  let suppliers=0, buyers=0;
  for(let j=0;j<DB.units.length;j++){
    const r=DB.units[j].roles;
    if(r.includes('供应商'))suppliers++;
    if(r.includes('采购商'))buyers++;
  }

  const rows=[...DB.orders].reverse().slice(0,8).map(o=>{
    return '<tr>'+
      '<td><b>'+escHtml(o.id)+'</b></td>'+
      '<td>'+escHtml(pName(o.buyerId))+'</td>'+
      '<td>'+escHtml(o.project||'-')+'</td>'+
      '<td>'+o.items.length+' 项</td>'+
      '<td>'+escHtml(fmtDelivery(o.delivery))+'</td>'+
      '<td><span class="tag '+STATUS_COLORS[o.status]+'">'+escHtml(o.status)+'</span></td>'+
      '<td>'+(o.status==='完成'||(o.status!=='未成交'&&o.status!=='取消'&&o.items.every(i=>isItemSourced(i)))?fmt(orderProfit(o)):'-')+'</td>'+
      '<td><button class="btn sm" onclick="goOrder(\''+o.id+'\')">'+icon('fileText')+'查看</button></td>'+
    '</tr>';
  }).join('');

  return todayHTML+
    '<div class="stats">'+
      '<div class="stat" onclick="go(\'orders\')" title="查看全部采购订单">'+
        '<div class="k">采购订单 <span style="float:right;font-size:12px;opacity:.6">全部</span></div>'+
        '<div class="v">'+DB.orders.length+'<small> 条</small></div>'+
      '</div>'+
      '<div class="stat" onclick="gotoPendingOrders()" title="筛选待处理订单">'+
        '<div class="k">待处理 <span style="float:right;font-size:12px;opacity:.6">待跟进</span></div>'+
        '<div class="v" style="color:var(--amber)">'+pendingCount+'<small> 条</small></div>'+
      '</div>'+
      '<div class="stat" onclick="go(\'units\');setTimeout(()=>{const f=document.getElementById(\'unitRoleFilter\');if(f){f.value=\'供应商\';f.dispatchEvent(new Event(\'change\'));}},100)" title="查看供应商列表">'+
        '<div class="k">供应商</div>'+
        '<div class="v" style="color:var(--green)">'+suppliers+'<small> 家</small></div>'+
      '</div>'+
      '<div class="stat" onclick="go(\'units\');setTimeout(()=>{const f=document.getElementById(\'unitRoleFilter\');if(f){f.value=\'采购商\';f.dispatchEvent(new Event(\'change\'));}},100)" title="查看采购商列表">'+
        '<div class="k">采购商</div>'+
        '<div class="v" style="color:var(--pri)">'+buyers+'<small> 家</small></div>'+
      '</div>'+
    '</div>'+
    (totalProfit>0?'<div class="profit-banner"><span class="profit-label">累计完成订单利润</span><span class="profit-val">'+fmt(totalProfit)+'</span><small style="font-size:13px;font-weight:400;opacity:.7"> 元（已完成订单）</small></div>':'')+
    (DB.orders.length>0?'':'<div class="card">'+
      '<h2>'+icon('zap','18')+'快速开始</h2>'+
      '<div style="display:flex;gap:10px;flex-wrap:wrap">'+
        '<button class="btn primary" onclick="newOrder()">'+icon('plus')+'新建采购订单</button>'+
        '<button class="btn" onclick="newUnit()">'+icon('users')+'新建关联单位</button>'+
        '<button class="btn" onclick="openBOMForm(-1)">'+icon('package')+'新建 BOM</button>'+
        '<button class="btn" onclick="newPrice()">'+icon('tag')+'新增报价</button>'+
      '</div>'+
    '</div>')+
    '<div class="card">'+
      '<h2>'+icon('doc','18')+'最近订单'+
        '<a href="javascript:void(0)" onclick="go(\'orders\')" style="font-size:13px;font-weight:400;color:var(--blue);text-decoration:none;margin-left:auto;display:flex;align-items:center;gap:4px">查看全部 '+icon('chevronRight','14')+'</a>'+
      '</h2>'+
      (rows?'<div class="table-wrap"><table><thead><tr><th>单号</th><th>采购商</th><th>项目</th><th>产品项</th><th>交期</th><th>状态</th><th>预估利润</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>':
        '<div class="empty-state">'+
          '<div class="es-icon">'+icon('doc',28)+'</div>'+
          '<div class="es-title">暂无订单记录</div>'+
          '<div class="es-desc">创建采购订单来管理供应商报价、寻货进度和结算</div>'+
          '<div class="es-action"><button class="btn primary" onclick="newOrder()">'+icon('plus')+'新建采购订单</button></div>'+
        '</div>'
      )+
    '</div>';
}

/* =========================================================
   B6：⌘K 新手引导气泡（Dashboard 首次显示；localStorage 去重，只弹一次）
   - 键名：wb_fastener_cmdk_tip_shown
   - 用户点击"立即试试"后标记已显示并打开 ⌘K 面板；点击"知道了"仅关闭并标记
   ========================================================= */
const _CMD_K_TIP_KEY = 'wb_fastener_cmdk_tip_shown';
function showCmdKTipIfNeeded(){
  try{
    if(localStorage.getItem(_CMD_K_TIP_KEY)) return;
    // 只在概览页（dashboard）显示；若渲染过程中未到概览，后续 render 会再检查
    if(view!=='dashboard') return;
  }catch(e){return;}
  // 避免与其他弹窗叠层：等 600ms 让主要内容渲染完成后出现
  setTimeout(function(){
    // 防止重复注入（同一页多次 render 可能叠加）
    if(document.querySelector('.cmdk-tip')) return;
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '') ||
                  (navigator.userAgentData && navigator.userAgentData.platform && /Mac|iOS/.test(navigator.userAgentData.platform));
    const kbd = isMac ? '⌘K' : 'Ctrl+K';
    const html = '<div class="cmdk-tip" role="dialog" aria-label="快捷键提示">'+
      '<div class="ct-title">'+icon('search','16')+'高效快捷键 <span class="kbd">'+kbd+'</span></div>'+
      '<div class="ct-body">按 <b>'+kbd+'</b> 随时打开全局命令面板：搜索订单/客户/报价，或直接输入问题问 AI 助手。<br>试试输入单号即可跳到对应订单详情。</div>'+
      '<div class="ct-actions">'+
        '<button class="ct-close" onclick="dismissCmdKTip(false)">知道了</button>'+
        '<button class="btn primary sm" onclick="dismissCmdKTip(true)">'+icon('zap','12')+'立即试试 '+kbd+'</button>'+
      '</div>'+
    '</div>';
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    document.body.appendChild(tmp.firstElementChild);
  }, 600);
}
function dismissCmdKTip(openPanel){
  try{localStorage.setItem(_CMD_K_TIP_KEY,'1');}catch(e){}
  const el = document.querySelector('.cmdk-tip');
  if(el){el.style.animation='cmdk-tip-in .18s reverse';setTimeout(()=>el.remove(),160);}
  if(openPanel && typeof openSearchPanel==='function'){
    setTimeout(function(){try{openSearchPanel();}catch(e){}},180);
  }
}
// render 完成后注册（通过 setTimeout 保证 DOM 已注入）
setTimeout(function(){
  // 挂到 window，供 router.render 之后调用；也在全局首次检查一次
  window.__showCmdKTipIfNeeded = showCmdKTipIfNeeded;
  try{showCmdKTipIfNeeded();}catch(e){}
},0);
