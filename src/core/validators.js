/* =========================================================
   共享校验模块（P3/R3 修复：视图层与 AI 工具层统一引用，消除双轨维护）
   零依赖：不引用 window/DB，纯函数，可在任意环境加载。
   挂在 window.FTValidators，CommonJS 下同时导出（node --check 兼容）。
   加载顺序：须在 ai-tools.js 之前（见 App.vue SCRIPTS）。
   ========================================================= */
(function(global){
  'use strict';

  /** 订单状态流转映射：当前状态 → 合法的下一站/终态分支 */
  const NEXT_STATUS={
    '待确认':['寻货中','取消'],
    '寻货中':['报价中','取消'],
    '报价中':['签约完成','未成交','取消'],
    '未成交':['报价中'],
    '签约完成':['送货中','异常'],
    '送货中':['完成','异常'],
    '完成':[],
    '异常':[],
    '取消':[]
  };

  /**
   * 订单状态流转校验：from → to 是否合法。
   * 消息文案与原 ai-tools.js flow_order_status validator 完全一致。
   * @param {string} from 当前状态
   * @param {string} to 目标状态
   * @returns {{ok:boolean,error:string}}
   */
  function canFlowOrderStatus(from,to){
    if(!(from in NEXT_STATUS))return {ok:false,error:'未知订单状态：'+from};
    if(from===to)return {ok:false,error:'订单已处于该状态：'+from};
    const allow=NEXT_STATUS[from]||[];
    if(!allow.includes(to))return {ok:false,error:'非法流转：'+from+' → '+to+'（允许：'+(allow.join('/')||'无')+'）'};
    return {ok:true,error:''};
  }

  /**
   * 订单保存必填校验（新建/编辑通用）。
   * 检查顺序 buyerId → items → delivery，与视图层原 saveOrder 一致。
   * @param {{buyerId?:string, delivery?:string, items?:Array}} input
   * @param {{requireDelivery?:boolean, checkItem?:boolean, itemNameRule?:string}} [opts]
   *   requireDelivery: 是否校验交货期（视图层 true；AI 建单 false 保持原语义）
   *   checkItem: 是否逐项校验明细（视图层 false 维持现状；AI 建单 true）
   *   itemNameRule: 'sku_or_name'（默认）| 'name_only'（AI 建单原语义：只看 name）
   * @returns {{ok:boolean, error:string, code?:string, index?:number}}
   *   code: no_buyer | no_items | no_delivery | item_no_name | item_bad_qty
   */
  function validateOrderInput(input,opts){
    opts=opts||{};
    const requireDelivery=opts.requireDelivery!==false;
    const items=Array.isArray(input&&input.items)?input.items:[];
    if(!(input&&input.buyerId&&String(input.buyerId).trim()))return {ok:false,error:'请选择采购商',code:'no_buyer'};
    if(!items.length)return {ok:false,error:'请至少添加一条产品明细',code:'no_items'};
    if(requireDelivery&&!(input&&input.delivery&&String(input.delivery).trim()))return {ok:false,error:'请选择交货期',code:'no_delivery'};
    if(opts.checkItem){
      for(let i=0;i<items.length;i++){
        const it=items[i]||{};
        const hasName=String(it.name||'').trim();
        if(opts.itemNameRule==='name_only'){
          if(!hasName)return {ok:false,error:'第 '+(i+1)+' 项产品名称不能为空',code:'item_no_name',index:i};
        }else if(!hasName&&!String(it.sku||'').trim()){
          return {ok:false,error:'第 '+(i+1)+' 项产品需填写 SKU 或名称',code:'item_no_name',index:i};
        }
        if(!isPositiveNumber(it.qty))return {ok:false,error:'第 '+(i+1)+' 项数量必须 > 0',code:'item_bad_qty',index:i};
      }
    }
    return {ok:true,error:''};
  }

  /**
   * 数字范围校验：必须是 >0 的有限数值（数量/单价/金额通用）。
   * 语义与原 `!(Number(x)>0)` 判定等价（''→0、'abc'→NaN、null→0 均判为非法）。
   * @param {*} v
   * @returns {boolean}
   */
  function isPositiveNumber(v){
    // 与原 `!(Number(x)>0)` 判定完全等价（''→0、'abc'→NaN、null→0 均判为非法；Infinity 保持原语义合法）
    return Number(v)>0;
  }

  const api={NEXT_STATUS,canFlowOrderStatus,validateOrderInput,isPositiveNumber};
  global.FTValidators=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
