// ai-tools.js — AI Function Calling 工具协议：schema 定义 + 校验/预览/执行/审计适配层
// 阶段2：先上 5 个简单写入工具（create_unit/update_unit/create_price/update_price/flow_order_status）
// 设计原则：AI 只产出参数，执行器复用项目现有校验规则与 saveDB() 链路；写入均记 aiOps 可回滚
const AIT=(function(){
  /** 写入工具统一前缀提示（描述里强声明「提案、不自动执行」） */
  const PROPOSAL_NOTE='此工具生成提案，前端将要求用户逐条确认，不会自动执行。';
  /** 敏感字段说明（不在 schema 中暴露，由用户在确认弹窗里手动补全） */
  const SENSITIVE_NOTE='敏感字段（联系人电话/微信、税号、银行账号、地址）不在工具参数中暴露，由用户在确认弹窗里手动补全。';

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

  /** 工具 schema（DeepSeek 兼容 OpenAI function calling 格式） */
  const TOOLS_DEFS=[
    {
      type:'function',
      function:{
        name:'create_unit',
        description:'起草新增关联单位（采购商/供应商）。'+PROPOSAL_NOTE+SENSITIVE_NOTE,
        parameters:{
          type:'object',
          properties:{
            name:{type:'string',description:'单位全称（必填，不可与现有单位重复）'},
            roles:{type:'array',items:{type:'string',enum:['采购商','供应商']},description:'角色（至少选一个，可双角色）'},
            rating:{type:'string',enum:['主力','备选','新客'],description:'合作评级（可选）'},
            term:{type:'string',enum:['货到付款','月结15天','月结30天','月结45天','月结60天','季结','面议','其他'],description:'结算账期（可选）'}
          },
          required:['name','roles']
        }
      }
    },
    {
      type:'function',
      function:{
        name:'update_unit',
        description:'起草修改关联单位字段（部分更新，只传需要改的字段）。'+PROPOSAL_NOTE+SENSITIVE_NOTE,
        parameters:{
          type:'object',
          properties:{
            unitId:{type:'string',description:'目标单位 ID（必填，从上下文快照获取）'},
            name:{type:'string',description:'新单位名称（可选，不可与其他单位重复）'},
            roles:{type:'array',items:{type:'string',enum:['采购商','供应商']},description:'新角色列表（可选，整体覆盖）'},
            rating:{type:'string',enum:['主力','备选','新客'],description:'新评级（可选）'},
            term:{type:'string',enum:['货到付款','月结15天','月结30天','月结45天','月结60天','季结','面议','其他'],description:'新账期（可选）'}
          },
          required:['unitId']
        }
      }
    },
    {
      type:'function',
      function:{
        name:'create_price',
        description:'起草新增供应商报价（六维规格属性可选，但至少提供 spec 文本或 bomSku 之一）。'+PROPOSAL_NOTE,
        parameters:{
          type:'object',
          properties:{
            unitId:{type:'string',description:'供应商单位 ID（必填，必须为「供应商」角色）'},
            bomSku:{type:'string',description:'BOM SKU 引用（可选，需存在于 DB.bom）'},
            spec:{type:'string',description:'规格文本（可选，如「M8×30 螺栓」）'},
            type:{type:'string',description:'类型（可选，如「螺栓」「螺母」，建议从 DB.specs.type 取值）'},
            standard:{type:'string',description:'标准（可选，如「GB/T」「DIN」）'},
            diameter:{type:'string',description:'直径（可选，如「M8」「M10」）'},
            hardness:{type:'string',description:'硬度（可选，如「8.8」「A2-70」）'},
            surface:{type:'string',description:'表面处理（可选，如「镀锌(白)」）'},
            material:{type:'string',description:'材质（可选，如「304」「Q235」）'},
            price:{type:'number',description:'单价（元/千支，必填，>0）'},
            validFrom:{type:'string',description:'有效期起（YYYY-MM-DD，可选，缺省取今日）'},
            contact:{type:'string',description:'供应商联系人姓名（可选）'},
            remark:{type:'string',description:'备注（可选）'}
          },
          required:['unitId','price']
        }
      }
    },
    {
      type:'function',
      function:{
        name:'update_price',
        description:'起草修改供应商报价字段（部分更新，只传需要改的字段）。'+PROPOSAL_NOTE,
        parameters:{
          type:'object',
          properties:{
            priceId:{type:'string',description:'目标报价 ID（必填，从上下文快照获取）'},
            bomSku:{type:'string',description:'新 BOM SKU（可选）'},
            spec:{type:'string',description:'新规格文本（可选）'},
            type:{type:'string',description:'新类型（可选）'},
            standard:{type:'string',description:'新标准（可选）'},
            diameter:{type:'string',description:'新直径（可选）'},
            hardness:{type:'string',description:'新硬度（可选）'},
            surface:{type:'string',description:'新表面处理（可选）'},
            material:{type:'string',description:'新材质（可选）'},
            price:{type:'number',description:'新单价（元/千支，>0，可选）'},
            validFrom:{type:'string',description:'新有效期起（可选）'},
            contact:{type:'string',description:'新联系人（可选）'},
            remark:{type:'string',description:'新备注（可选）'}
          },
          required:['priceId']
        }
      }
    },
    {
      type:'function',
      function:{
        name:'flow_order_status',
        description:'起草流转采购订单状态。必须守 STATUS_FLOW：只能前进到下一站，或转入「异常」「取消」终态分支；「未成交」可恢复回「报价中」；终态（完成/异常/取消）不可流转。'+PROPOSAL_NOTE,
        parameters:{
          type:'object',
          properties:{
            orderId:{type:'string',description:'目标订单 ID（必填）'},
            toStatus:{type:'string',enum:['待确认','寻货中','报价中','未成交','签约完成','送货中','异常','完成','取消'],description:'目标状态（必填）'}
          },
          required:['orderId','toStatus']
        }
      }
    },
    // ===== 阶段3：查询类工具（自动执行，不经确认弹窗） =====
    {
      type:'function',
      function:{
        name:'query_units',
        description:'查询关联单位列表（脱敏：不返回联系人电话/微信/税号/银行账号/地址）。用于查找 unitId、了解供应商/采购商库存。',
        parameters:{
          type:'object',
          properties:{
            keyword:{type:'string',description:'名称关键词（可选，模糊匹配）'},
            role:{type:'string',enum:['采购商','供应商'],description:'按角色筛选（可选）'},
            rating:{type:'string',enum:['主力','备选','新客'],description:'按评级筛选（可选）'}
          }
        }
      }
    },
    {
      type:'function',
      function:{
        name:'query_specs',
        description:'查询规格属性枚举值。DB.specs 是六维属性（type/standard/diameter/hardness/surface/material）的枚举数组。',
        parameters:{
          type:'object',
          properties:{
            dimension:{type:'string',enum:['type','standard','diameter','hardness','surface','material'],description:'维度（可选，缺省返回全部六维）'}
          }
        }
      }
    },
    {
      type:'function',
      function:{
        name:'query_bom',
        description:'查询 BOM 列表（产品标准库）。',
        parameters:{
          type:'object',
          properties:{
            keyword:{type:'string',description:'名称/规格关键词（可选）'},
            sku:{type:'string',description:'按 SKU 精确匹配（可选）'}
          }
        }
      }
    },
    {
      type:'function',
      function:{
        name:'query_prices',
        description:'查询供应商报价列表（脱敏：不返回联系人电话）。',
        parameters:{
          type:'object',
          properties:{
            unitId:{type:'string',description:'按供应商 ID 筛选（可选）'},
            spec:{type:'string',description:'按规格文本筛选（可选，模糊匹配）'}
          }
        }
      }
    },
    {
      type:'function',
      function:{
        name:'query_orders',
        description:'查询采购订单摘要（含产品明细 items[]，每项带 itemId 供后续操作）。脱敏：不返回送货地址/联系人电话。',
        parameters:{
          type:'object',
          properties:{
            status:{type:'string',enum:['待确认','寻货中','报价中','未成交','签约完成','送货中','异常','完成','取消'],description:'按状态筛选（可选）'},
            keyword:{type:'string',description:'订单号/采购商/项目关键词（可选）'}
          }
        }
      }
    },
    {
      type:'function',
      function:{
        name:'query_settlements',
        description:'查询结算记录列表。type=receipt 为采购商应收，type=payment 为供应商应付。',
        parameters:{
          type:'object',
          properties:{
            type:{type:'string',enum:['receipt','payment'],description:'结算类型（可选）'},
            unitId:{type:'string',description:'按单位筛选（可选）'}
          }
        }
      }
    },
    {
      type:'function',
      function:{
        name:'query_invoices',
        description:'查询发票记录列表。type=issue 为开票（给采购商开票），type=receive 为收票（收供应商发票）。',
        parameters:{
          type:'object',
          properties:{
            type:{type:'string',enum:['issue','receive'],description:'发票类型（可选）'},
            unitId:{type:'string',description:'按单位筛选（可选）'}
          }
        }
      }
    },
    // ===== 阶段3：BOM/属性写入 =====
    {
      type:'function',
      function:{
        name:'create_bom',
        description:'起草新增 BOM 条目（产品标准库）。'+PROPOSAL_NOTE,
        parameters:{
          type:'object',
          properties:{
            sku:{type:'string',description:'SKU 编号（必填，唯一）'},
            name:{type:'string',description:'产品名称（必填）'},
            spec:{type:'string',description:'规格文本（可选）'},
            type:{type:'string',description:'类型（可选）'},
            standard:{type:'string',description:'标准（可选）'},
            diameter:{type:'string',description:'直径（可选）'},
            hardness:{type:'string',description:'硬度（可选）'},
            surface:{type:'string',description:'表面处理（可选）'},
            material:{type:'string',description:'材质（可选）'}
          },
          required:['sku','name']
        }
      }
    },
    {
      type:'function',
      function:{
        name:'update_bom',
        description:'起草修改 BOM 条目字段（部分更新）。'+PROPOSAL_NOTE,
        parameters:{
          type:'object',
          properties:{
            bomId:{type:'string',description:'目标 BOM ID（必填）'},
            name:{type:'string',description:'新名称（可选）'},
            spec:{type:'string',description:'新规格（可选）'},
            type:{type:'string',description:'新类型（可选）'},
            standard:{type:'string',description:'新标准（可选）'},
            diameter:{type:'string',description:'新直径（可选）'},
            hardness:{type:'string',description:'新硬度（可选）'},
            surface:{type:'string',description:'新表面处理（可选）'},
            material:{type:'string',description:'新材质（可选）'}
          },
          required:['bomId']
        }
      }
    },
    {
      type:'function',
      function:{
        name:'set_spec_value',
        description:'起草新增规格属性枚举值（幂等：已存在则跳过）。'+PROPOSAL_NOTE,
        parameters:{
          type:'object',
          properties:{
            dimension:{type:'string',enum:['type','standard','diameter','hardness','surface','material'],description:'维度（必填）'},
            value:{type:'string',description:'枚举值（必填）'}
          },
          required:['dimension','value']
        }
      }
    },
    // ===== 阶段3：订单复杂操作 =====
    {
      type:'function',
      function:{
        name:'create_order',
        description:'起草新建采购订单（含产品明细 items[]）。新订单默认状态「待确认」。'+PROPOSAL_NOTE+SENSITIVE_NOTE,
        parameters:{
          type:'object',
          properties:{
            buyerId:{type:'string',description:'采购商单位 ID（必填）'},
            project:{type:'string',description:'项目名称（可选）'},
            deliveryDate:{type:'string',description:'交货日期 YYYY-MM-DD（可选）'},
            buyerContact:{type:'string',description:'采购方对接人姓名（可选，电话不通过此工具填写）'},
            items:{
              type:'array',
              description:'产品明细（至少 1 项）',
              items:{
                type:'object',
                properties:{
                  sku:{type:'string',description:'SKU（可选）'},
                  name:{type:'string',description:'产品名称（必填）'},
                  spec:{type:'string',description:'规格文本（可选）'},
                  qty:{type:'number',description:'需求数量（必填，>0）'},
                  salePrice:{type:'number',description:'销售单价（可选）'},
                  quotePrice:{type:'number',description:'报价（可选）'},
                  bomSku:{type:'string',description:'BOM SKU 引用（可选）'},
                  usage:{type:'string',description:'用途（可选）'},
                  remark:{type:'string',description:'备注（可选）'}
                }
              }
            }
          },
          required:['buyerId','items']
        }
      }
    },
    {
      type:'function',
      function:{
        name:'update_order_meta',
        description:'起草修改订单元信息（采购商/项目/交期/对接人，部分更新）。'+PROPOSAL_NOTE,
        parameters:{
          type:'object',
          properties:{
            orderId:{type:'string',description:'目标订单 ID（必填）'},
            buyerId:{type:'string',description:'新采购商 ID（可选）'},
            project:{type:'string',description:'新项目（可选）'},
            deliveryDate:{type:'string',description:'新交期（可选）'},
            buyerContact:{type:'string',description:'新对接人（可选）'}
          },
          required:['orderId']
        }
      }
    },
    {
      type:'function',
      function:{
        name:'add_order_item',
        description:'起草向订单追加产品明细。'+PROPOSAL_NOTE,
        parameters:{
          type:'object',
          properties:{
            orderId:{type:'string',description:'目标订单 ID（必填）'},
            sku:{type:'string',description:'SKU（可选）'},
            name:{type:'string',description:'产品名称（必填）'},
            spec:{type:'string',description:'规格文本（可选）'},
            qty:{type:'number',description:'需求数量（必填，>0）'},
            salePrice:{type:'number',description:'销售单价（可选）'},
            quotePrice:{type:'number',description:'报价（可选）'},
            bomSku:{type:'string',description:'BOM SKU 引用（可选）'},
            usage:{type:'string',description:'用途（可选）'},
            remark:{type:'string',description:'备注（可选）'}
          },
          required:['orderId','name','qty']
        }
      }
    },
    {
      type:'function',
      function:{
        name:'update_order_item',
        description:'起草修改订单产品明细字段（部分更新，用 itemId 标识）。'+PROPOSAL_NOTE,
        parameters:{
          type:'object',
          properties:{
            orderId:{type:'string',description:'目标订单 ID（必填）'},
            itemId:{type:'string',description:'目标明细 ID（必填，从 query_orders 获取）'},
            name:{type:'string',description:'新名称（可选）'},
            spec:{type:'string',description:'新规格（可选）'},
            qty:{type:'number',description:'新数量（可选，>0）'},
            salePrice:{type:'number',description:'新销售单价（可选）'},
            quotePrice:{type:'number',description:'新报价（可选）'},
            usage:{type:'string',description:'新用途（可选）'},
            remark:{type:'string',description:'新备注（可选）'}
          },
          required:['orderId','itemId']
        }
      }
    },
    {
      type:'function',
      function:{
        name:'remove_order_item',
        description:'起草移除订单产品明细（走回收站，可恢复）。'+PROPOSAL_NOTE,
        parameters:{
          type:'object',
          properties:{
            orderId:{type:'string',description:'目标订单 ID（必填）'},
            itemId:{type:'string',description:'目标明细 ID（必填）'}
          },
          required:['orderId','itemId']
        }
      }
    },
    {
      type:'function',
      function:{
        name:'assign_supplier',
        description:'起草为订单产品明细从价格库分配供应商（addMatchSupplier 的 AI 版）。校验：分配数量 + 已分配 ≤ 需求量；同供应商不重复。'+PROPOSAL_NOTE,
        parameters:{
          type:'object',
          properties:{
            orderId:{type:'string',description:'目标订单 ID（必填）'},
            itemId:{type:'string',description:'目标明细 ID（必填）'},
            priceId:{type:'string',description:'价格库报价 ID（必填，从 query_prices 获取）'},
            allocQty:{type:'number',description:'分配数量（必填，>0）'}
          },
          required:['orderId','itemId','priceId','allocQty']
        }
      }
    },
    {
      type:'function',
      function:{
        name:'add_manual_supplier',
        description:'起草为订单产品明细手动录入供应商（manualSupplier 的 AI 版，会自动创建/复用单位并同步价格库）。'+PROPOSAL_NOTE+SENSITIVE_NOTE,
        parameters:{
          type:'object',
          properties:{
            orderId:{type:'string',description:'目标订单 ID（必填）'},
            itemId:{type:'string',description:'目标明细 ID（必填）'},
            unitName:{type:'string',description:'供应商名称（必填，已存在则复用）'},
            contact:{type:'string',description:'联系人姓名（可选，电话不通过此工具填写）'},
            price:{type:'number',description:'采购单价（必填，>0）'},
            allocQty:{type:'number',description:'分配数量（必填，>0）'},
            stockNote:{type:'string',description:'库存备注（可选）'}
          },
          required:['orderId','itemId','unitName','price','allocQty']
        }
      }
    },
    {
      type:'function',
      function:{
        name:'remove_sourcing_option',
        description:'起草移除订单产品明细的某个供应商分配（removeOption 的 AI 版）。'+PROPOSAL_NOTE,
        parameters:{
          type:'object',
          properties:{
            orderId:{type:'string',description:'目标订单 ID（必填）'},
            itemId:{type:'string',description:'目标明细 ID（必填）'},
            optionId:{type:'string',description:'分配记录 ID（必填，从 query_orders 的 items[].options 获取）'}
          },
          required:['orderId','itemId','optionId']
        }
      }
    },
    // ===== 阶段3：结算/发票写入 =====
    {
      type:'function',
      function:{
        name:'create_settlement',
        description:'起草新增结算记录（应收/应付）。type=receipt 为采购商应收，type=payment 为供应商应付。'+PROPOSAL_NOTE,
        parameters:{
          type:'object',
          properties:{
            type:{type:'string',enum:['receipt','payment'],description:'结算类型（必填）'},
            unitId:{type:'string',description:'对方单位 ID（必填）'},
            date:{type:'string',description:'结算日期 YYYY-MM-DD（必填）'},
            amount:{type:'number',description:'金额（必填，>0）'},
            person:{type:'string',description:'经办人（可选）'},
            note:{type:'string',description:'备注（可选）'},
            orders:{type:'array',items:{type:'object',properties:{orderId:{type:'string'},amount:{type:'number'}}},description:'关联订单及分摊金额（可选）'}
          },
          required:['type','unitId','date','amount']
        }
      }
    },
    {
      type:'function',
      function:{
        name:'update_settlement',
        description:'起草修改结算记录字段（部分更新）。'+PROPOSAL_NOTE,
        parameters:{
          type:'object',
          properties:{
            settleId:{type:'string',description:'目标结算 ID（必填）'},
            date:{type:'string',description:'新日期（可选）'},
            amount:{type:'number',description:'新金额（可选，>0）'},
            person:{type:'string',description:'新经办人（可选）'},
            note:{type:'string',description:'新备注（可选）'}
          },
          required:['settleId']
        }
      }
    },
    {
      type:'function',
      function:{
        name:'create_invoice',
        description:'起草新增发票记录。type=issue 为开票（给采购商），type=receive 为收票（收供应商）。'+PROPOSAL_NOTE,
        parameters:{
          type:'object',
          properties:{
            type:{type:'string',enum:['issue','receive'],description:'发票类型（必填）'},
            unitId:{type:'string',description:'对方单位 ID（必填）'},
            date:{type:'string',description:'开票/收票日期 YYYY-MM-DD（必填）'},
            amount:{type:'number',description:'金额（必填，>0）'},
            remark:{type:'string',description:'备注（可选）'}
          },
          required:['type','unitId','date','amount']
        }
      }
    },
    {
      type:'function',
      function:{
        name:'update_invoice',
        description:'起草修改发票记录字段（部分更新）。'+PROPOSAL_NOTE,
        parameters:{
          type:'object',
          properties:{
            invoiceId:{type:'string',description:'目标发票 ID（必填）'},
            date:{type:'string',description:'新日期（可选）'},
            amount:{type:'number',description:'新金额（可选，>0）'},
            remark:{type:'string',description:'新备注（可选）'}
          },
          required:['invoiceId']
        }
      }
    },
    // ===== 阶段3：删除类工具（走回收站，可恢复） =====
    {
      type:'function',
      function:{
        name:'delete_unit',
        description:'起草软删除关联单位（走回收站，可恢复；若单位被订单/报价引用会先阻断，需先解除引用）。'+PROPOSAL_NOTE,
        parameters:{
          type:'object',
          properties:{unitId:{type:'string',description:'目标单位 ID（必填）'}},
          required:['unitId']
        }
      }
    },
    {
      type:'function',
      function:{
        name:'delete_bom',
        description:'起草软删除 BOM 条目（走回收站，可恢复）。'+PROPOSAL_NOTE,
        parameters:{
          type:'object',
          properties:{bomId:{type:'string',description:'目标 BOM ID（必填）'}},
          required:['bomId']
        }
      }
    },
    {
      type:'function',
      function:{
        name:'delete_price',
        description:'起草软删除供应商报价（走回收站，可恢复）。'+PROPOSAL_NOTE,
        parameters:{
          type:'object',
          properties:{priceId:{type:'string',description:'目标报价 ID（必填）'}},
          required:['priceId']
        }
      }
    },
    {
      type:'function',
      function:{
        name:'delete_order',
        description:'起草软删除采购订单（走回收站，可恢复；含全部产品明细与寻货分配）。'+PROPOSAL_NOTE,
        parameters:{
          type:'object',
          properties:{orderId:{type:'string',description:'目标订单 ID（必填）'}},
          required:['orderId']
        }
      }
    },
    {
      type:'function',
      function:{
        name:'delete_spec_value',
        description:'起草软删除规格属性枚举值（走回收站，可恢复）。'+PROPOSAL_NOTE,
        parameters:{
          type:'object',
          properties:{
            dimension:{type:'string',enum:['type','standard','diameter','hardness','surface','material'],description:'维度（必填）'},
            value:{type:'string',description:'枚举值（必填）'}
          },
          required:['dimension','value']
        }
      }
    },
    {
      type:'function',
      function:{
        name:'delete_settlement',
        description:'起草软删除结算记录（走回收站，可恢复）。'+PROPOSAL_NOTE,
        parameters:{
          type:'object',
          properties:{settleId:{type:'string',description:'目标结算 ID（必填）'}},
          required:['settleId']
        }
      }
    },
    {
      type:'function',
      function:{
        name:'delete_invoice',
        description:'起草软删除发票记录（走回收站，可恢复）。'+PROPOSAL_NOTE,
        parameters:{
          type:'object',
          properties:{invoiceId:{type:'string',description:'目标发票 ID（必填）'}},
          required:['invoiceId']
        }
      }
    },
    // ===== 阶段4：功能层工具（纯系统动作，自动执行不经弹窗） =====
    {
      type:'function',
      function:{
        name:'navigate_view',
        description:'视图导航：跳转到指定页面（dashboard/units/specs/bom/prices/orders/settlements/invoices/data）。viewName=orders 且提供 orderId 时导航到订单详情。此工具立即执行，不需确认。',
        parameters:{
          type:'object',
          properties:{
            viewName:{type:'string',enum:['dashboard','units','specs','bom','prices','orders','settlements','invoices','data'],description:'目标视图名（必填）'},
            orderId:{type:'string',description:'订单 ID（可选，仅 viewName=orders 时生效，导航到订单详情）'}
          },
          required:['viewName']
        }
      }
    },
    {
      type:'function',
      function:{
        name:'export_order_excel',
        description:'导出采购订单为 Excel 文件（触发浏览器下载，按订单状态自动选择导出模板）。此工具立即执行，不需确认。',
        parameters:{
          type:'object',
          properties:{orderId:{type:'string',description:'目标订单 ID（必填）'}},
          required:['orderId']
        }
      }
    },
    {
      type:'function',
      function:{
        name:'open_settlement_drawer',
        description:'打开指定单位的结算详情抽屉（按 tabType 切换收款/付款视图）。此工具立即执行，不需确认。',
        parameters:{
          type:'object',
          properties:{
            unitId:{type:'string',description:'目标单位 ID（必填）'},
            tabType:{type:'string',enum:['receipt','payment'],description:'结算标签类型：receipt=收款、payment=付款（可选，默认 receipt）'}
          },
          required:['unitId']
        }
      }
    },
    {
      type:'function',
      function:{
        name:'open_invoice_drawer',
        description:'打开发票编辑抽屉（用于查看/编辑指定发票记录）。此工具立即执行，不需确认。',
        parameters:{
          type:'object',
          properties:{invoiceId:{type:'string',description:'目标发票 ID（必填）'}},
          required:['invoiceId']
        }
      }
    }
  ];

  /** 工具元数据：name → {label, tagCls, kind}（kind: write/flow） */
  const TOOL_META={
    create_unit:{label:'新增单位',tagCls:'ok',kind:'write'},
    update_unit:{label:'修改单位',tagCls:'info',kind:'write'},
    create_price:{label:'新增报价',tagCls:'ok',kind:'write'},
    update_price:{label:'修改报价',tagCls:'info',kind:'write'},
    flow_order_status:{label:'状态流转',tagCls:'warn',kind:'flow'},
    // 阶段3：查询类（kind: query，自动执行不经弹窗）
    query_units:{label:'查询单位',tagCls:'info',kind:'query'},
    query_specs:{label:'查询属性',tagCls:'info',kind:'query'},
    query_bom:{label:'查询BOM',tagCls:'info',kind:'query'},
    query_prices:{label:'查询报价',tagCls:'info',kind:'query'},
    query_orders:{label:'查询订单',tagCls:'info',kind:'query'},
    query_settlements:{label:'查询结算',tagCls:'info',kind:'query'},
    query_invoices:{label:'查询发票',tagCls:'info',kind:'query'},
    // 阶段3：BOM/属性写入
    create_bom:{label:'新增BOM',tagCls:'ok',kind:'write'},
    update_bom:{label:'修改BOM',tagCls:'info',kind:'write'},
    set_spec_value:{label:'新增属性值',tagCls:'ok',kind:'write'},
    // 阶段3：订单复杂操作
    create_order:{label:'新建订单',tagCls:'ok',kind:'write'},
    update_order_meta:{label:'修改订单',tagCls:'info',kind:'write'},
    add_order_item:{label:'追加明细',tagCls:'ok',kind:'write'},
    update_order_item:{label:'修改明细',tagCls:'info',kind:'write'},
    remove_order_item:{label:'移除明细',tagCls:'warn',kind:'delete'},
    assign_supplier:{label:'分配供应商',tagCls:'ok',kind:'write'},
    add_manual_supplier:{label:'手动录入供应商',tagCls:'ok',kind:'write'},
    remove_sourcing_option:{label:'移除分配',tagCls:'warn',kind:'delete'},
    // 阶段3：结算/发票写入
    create_settlement:{label:'新增结算',tagCls:'ok',kind:'write'},
    update_settlement:{label:'修改结算',tagCls:'info',kind:'write'},
    create_invoice:{label:'新增发票',tagCls:'ok',kind:'write'},
    update_invoice:{label:'修改发票',tagCls:'info',kind:'write'},
    // 阶段3：删除类
    delete_unit:{label:'删除单位',tagCls:'err',kind:'delete'},
    delete_bom:{label:'删除BOM',tagCls:'err',kind:'delete'},
    delete_price:{label:'删除报价',tagCls:'err',kind:'delete'},
    delete_order:{label:'删除订单',tagCls:'err',kind:'delete'},
    delete_spec_value:{label:'删除属性值',tagCls:'err',kind:'delete'},
    delete_settlement:{label:'删除结算',tagCls:'err',kind:'delete'},
    delete_invoice:{label:'删除发票',tagCls:'err',kind:'delete'},
    // 阶段4：功能层工具（kind: flow，纯 UI 动作，自动执行不经弹窗）
    navigate_view:{label:'视图导航',tagCls:'info',kind:'flow'},
    export_order_excel:{label:'导出Excel',tagCls:'info',kind:'flow'},
    open_settlement_drawer:{label:'打开结算',tagCls:'info',kind:'flow'},
    open_invoice_drawer:{label:'打开发票',tagCls:'info',kind:'flow'}
  };

  /** 阶段4：功能层工具名集合（用于 aiWriteLoop 分流，自动执行不经弹窗） */
  const FLOW_TOOL_NAMES=new Set(['navigate_view','export_order_excel','open_settlement_drawer','open_invoice_drawer']);

  /** 工具校验：name → (args) → {ok:boolean,error:string,preview:object} */
  const validators={
    create_unit(args){
      const name=String(args.name||'').trim();
      if(!name)return {ok:false,error:'单位名称不能为空'};
      if(DB.units.some(u=>u.name===name))return {ok:false,error:'已存在同名单位：'+name};
      const roles=Array.isArray(args.roles)?args.roles.filter(r=>['采购商','供应商'].includes(r)):[];
      if(!roles.length)return {ok:false,error:'至少选择一个角色（采购商/供应商）'};
      if(args.rating&&!['主力','备选','新客'].includes(args.rating))return {ok:false,error:'rating 取值非法'};
      if(args.term&&!['货到付款','月结15天','月结30天','月结45天','月结60天','季结','面议','其他'].includes(args.term))return {ok:false,error:'term 取值非法'};
      // 敏感字段（可选，由用户在确认弹窗补全）：电话/地址/税号/开户行/账号
      const sensitive=['phone','address','taxId','bank','accountNo'];
      for(const k of sensitive){
        if(args[k]!==undefined&&args[k]!==null&&String(args[k]).length>200)return {ok:false,error:k+' 长度超限'};
      }
      const after={id:'(自动生成)',name,roles,rating:args.rating||'',term:args.term||'',contacts:[],invoice:{},__sensitive:null};
      return {ok:true,preview:{after}};
    },
    update_unit(args){
      const u=DB.units.find(x=>x.id===args.unitId);
      if(!u)return {ok:false,error:'单位不存在：'+args.unitId};
      const before=_snap({id:u.id,name:u.name,roles:u.roles,rating:u.rating,term:u.term});
      const patch={};
      if(args.name!==undefined){
        const nm=String(args.name).trim();
        if(!nm)return {ok:false,error:'单位名称不能为空'};
        if(DB.units.some(x=>x.id!==u.id&&x.name===nm))return {ok:false,error:'已存在同名单位：'+nm};
        patch.name=nm;
      }
      if(args.roles!==undefined){
        const roles=Array.isArray(args.roles)?args.roles.filter(r=>['采购商','供应商'].includes(r)):[];
        if(!roles.length)return {ok:false,error:'至少选择一个角色'};
        patch.roles=roles;
      }
      if(args.rating!==undefined){
        if(!['主力','备选','新客'].includes(args.rating))return {ok:false,error:'rating 取值非法'};
        patch.rating=args.rating;
      }
      if(args.term!==undefined){
        if(!['货到付款','月结15天','月结30天','月结45天','月结60天','季结','面议','其他'].includes(args.term))return {ok:false,error:'term 取值非法'};
        patch.term=args.term;
      }
      if(!Object.keys(patch).length)return {ok:false,error:'未提供任何更新字段'};
      const after=Object.assign(_snap(before),patch);
      return {ok:true,preview:{before,after,patch}};
    },
    create_price(args){
      const u=DB.units.find(x=>x.id===args.unitId);
      if(!u)return {ok:false,error:'供应商不存在：'+args.unitId};
      if(!u.roles.includes('供应商'))return {ok:false,error:'目标单位不是供应商：'+u.name};
      const price=Number(args.price);
      if(!(price>0))return {ok:false,error:'单价必须 > 0'};
      const attrs={type:args.type||'',standard:args.standard||'',diameter:args.diameter||'',hardness:args.hardness||'',surface:args.surface||'',material:args.material||''};
      const specText=String(args.spec||'');
      const bomSku=String(args.bomSku||'');
      if(!specText&&!bomSku)return {ok:false,error:'至少提供 spec 或 bomSku 之一'};
      if(bomSku&&!DB.bom.some(b=>b.sku===bomSku))return {ok:false,error:'BOM SKU 不存在：'+bomSku};
      if(typeof isPriceDuplicate==='function'&&isPriceDuplicate(args.unitId,bomSku,specText,attrs,null))return {ok:false,error:'已存在相同供应商+SKU+规格+属性的报价'};
      const after={id:'(自动生成)',unitId:args.unitId,unitName:u.name,bomSku,spec:specText,...attrs,price,validFrom:args.validFrom||today(),contact:args.contact||'',remark:args.remark||''};
      return {ok:true,preview:{after}};
    },
    update_price(args){
      const p=DB.prices.find(x=>x.id===args.priceId);
      if(!p)return {ok:false,error:'报价不存在：'+args.priceId};
      const before=_snap({id:p.id,unitId:p.unitId,bomSku:p.bomSku,spec:p.spec,type:p.type,standard:p.standard,diameter:p.diameter,hardness:p.hardness,surface:p.surface,material:p.material,price:p.price,validFrom:p.validFrom,contact:p.contact,remark:p.remark});
      const patch={};
      if(args.bomSku!==undefined){if(args.bomSku&&!DB.bom.some(b=>b.sku===args.bomSku))return {ok:false,error:'BOM SKU 不存在：'+args.bomSku};patch.bomSku=args.bomSku;}
      if(args.spec!==undefined)patch.spec=args.spec;
      if(args.type!==undefined)patch.type=args.type;
      if(args.standard!==undefined)patch.standard=args.standard;
      if(args.diameter!==undefined)patch.diameter=args.diameter;
      if(args.hardness!==undefined)patch.hardness=args.hardness;
      if(args.surface!==undefined)patch.surface=args.surface;
      if(args.material!==undefined)patch.material=args.material;
      if(args.price!==undefined){const pr=Number(args.price);if(!(pr>0))return {ok:false,error:'单价必须 > 0'};patch.price=pr;}
      if(args.validFrom!==undefined)patch.validFrom=args.validFrom;
      if(args.contact!==undefined)patch.contact=args.contact;
      if(args.remark!==undefined)patch.remark=args.remark;
      if(!Object.keys(patch).length)return {ok:false,error:'未提供任何更新字段'};
      const attrs={type:patch.type!==undefined?patch.type:p.type,standard:patch.standard!==undefined?patch.standard:p.standard,diameter:patch.diameter!==undefined?patch.diameter:p.diameter,hardness:patch.hardness!==undefined?patch.hardness:p.hardness,surface:patch.surface!==undefined?patch.surface:p.surface,material:patch.material!==undefined?patch.material:p.material};
      if(typeof isPriceDuplicate==='function'&&isPriceDuplicate(p.unitId,patch.bomSku!==undefined?patch.bomSku:p.bomSku,patch.spec!==undefined?patch.spec:p.spec,attrs,p.id))return {ok:false,error:'修改后将与已有报价重复'};
      const after=Object.assign(_snap(before),patch);
      return {ok:true,preview:{before,after,patch}};
    },
    flow_order_status(args){
      const o=DB.orders.find(x=>x.id===args.orderId);
      if(!o)return {ok:false,error:'订单不存在：'+args.orderId};
      if(!ORDER_STATUSES.includes(args.toStatus))return {ok:false,error:'toStatus 取值非法：'+args.toStatus};
      if(o.status===args.toStatus)return {ok:false,error:'订单已处于该状态：'+o.status};
      const allow=NEXT_STATUS[o.status]||[];
      if(!allow.includes(args.toStatus))return {ok:false,error:'非法流转：'+o.status+' → '+args.toStatus+'（允许：'+(allow.join('/')||'无')+'）'};
      return {ok:true,preview:{orderId:o.id,buyer:unitNameSafe(o.buyerId),before:o.status,after:args.toStatus}};
    },
    // ===== 阶段3：查询类校验（轻量，主要在 runQuery 里执行） =====
    query_units(args){
      if(args.role&&!['采购商','供应商'].includes(args.role))return {ok:false,error:'role 取值非法'};
      if(args.rating&&!['主力','备选','新客'].includes(args.rating))return {ok:false,error:'rating 取值非法'};
      return {ok:true,preview:{}};
    },
    query_specs(args){
      if(args.dimension&&!['type','standard','diameter','hardness','surface','material'].includes(args.dimension))return {ok:false,error:'dimension 取值非法'};
      return {ok:true,preview:{}};
    },
    query_bom(){return {ok:true,preview:{}}},
    query_prices(args){
      if(args.unitId&&!DB.units.some(u=>u.id===args.unitId))return {ok:false,error:'供应商不存在：'+args.unitId};
      return {ok:true,preview:{}};
    },
    query_orders(args){
      if(args.status&&!ORDER_STATUSES.includes(args.status))return {ok:false,error:'status 取值非法'};
      return {ok:true,preview:{}};
    },
    query_settlements(args){
      if(args.type&&!['receipt','payment'].includes(args.type))return {ok:false,error:'type 取值非法'};
      return {ok:true,preview:{}};
    },
    query_invoices(args){
      if(args.type&&!['issue','receive'].includes(args.type))return {ok:false,error:'type 取值非法'};
      return {ok:true,preview:{}};
    },
    // ===== 阶段3：BOM/属性写入校验 =====
    create_bom(args){
      const sku=String(args.sku||'').trim();
      if(!sku)return {ok:false,error:'SKU 不能为空'};
      if(DB.bom.some(b=>b.sku===sku))return {ok:false,error:'已存在同 SKU：'+sku};
      if(!String(args.name||'').trim())return {ok:false,error:'产品名称不能为空'};
      const after={id:'(自动生成)',sku,name:args.name,spec:args.spec||'',type:args.type||'',standard:args.standard||'',diameter:args.diameter||'',hardness:args.hardness||'',surface:args.surface||'',material:args.material||''};
      return {ok:true,preview:{after}};
    },
    update_bom(args){
      const b=DB.bom.find(x=>x.id===args.bomId);
      if(!b)return {ok:false,error:'BOM 不存在：'+args.bomId};
      const before=_snap({id:b.id,sku:b.sku,name:b.name,spec:b.spec,type:b.type,standard:b.standard,diameter:b.diameter,hardness:b.hardness,surface:b.surface,material:b.material});
      const patch={};
      ['name','spec','type','standard','diameter','hardness','surface','material'].forEach(k=>{if(args[k]!==undefined)patch[k]=args[k];});
      if(!Object.keys(patch).length)return {ok:false,error:'未提供任何更新字段'};
      const after=Object.assign(_snap(before),patch);
      return {ok:true,preview:{before,after,patch}};
    },
    set_spec_value(args){
      if(!['type','standard','diameter','hardness','surface','material'].includes(args.dimension))return {ok:false,error:'dimension 取值非法'};
      if(!String(args.value||'').trim())return {ok:false,error:'value 不能为空'};
      const exists=(DB.specs[args.dimension]||[]).includes(args.value);
      return {ok:true,preview:{dimension:args.dimension,value:args.value,exists}};
    },
    // ===== 阶段3：订单复杂操作校验 =====
    create_order(args){
      const u=DB.units.find(x=>x.id===args.buyerId);
      if(!u)return {ok:false,error:'采购商不存在：'+args.buyerId};
      if(!u.roles.includes('采购商'))return {ok:false,error:'目标单位不是采购商：'+u.name};
      const items=Array.isArray(args.items)?args.items:[];
      if(!items.length)return {ok:false,error:'至少需要 1 项产品明细'};
      for(let i=0;i<items.length;i++){
        const it=items[i];
        if(!String(it.name||'').trim())return {ok:false,error:'第 '+(i+1)+' 项产品名称不能为空'};
        if(!(Number(it.qty)>0))return {ok:false,error:'第 '+(i+1)+' 项数量必须 > 0'};
      }
      const after={id:'(自动生成)',buyerId:args.buyerId,buyerName:u.name,project:args.project||'',deliveryDate:args.deliveryDate||'',buyerContact:args.buyerContact||'',status:'待确认',items:items.map(it=>({id:'(自动生成)',name:it.name,spec:it.spec||'',qty:it.qty,salePrice:it.salePrice||0,quotePrice:it.quotePrice||0,bomSku:it.bomSku||''}))};
      return {ok:true,preview:{after}};
    },
    update_order_meta(args){
      const o=DB.orders.find(x=>x.id===args.orderId);
      if(!o)return {ok:false,error:'订单不存在：'+args.orderId};
      const before=_snap({buyerId:o.buyerId,project:o.project,deliveryDate:(o.delivery&&(o.delivery.date||o.delivery.time))||'',buyerContact:o.buyerContact||''});
      const patch={};
      if(args.buyerId!==undefined){const u=DB.units.find(x=>x.id===args.buyerId);if(!u)return {ok:false,error:'采购商不存在：'+args.buyerId};if(!u.roles.includes('采购商'))return {ok:false,error:'目标单位不是采购商'};patch.buyerId=args.buyerId;}
      if(args.project!==undefined)patch.project=args.project;
      if(args.deliveryDate!==undefined)patch.deliveryDate=args.deliveryDate;
      if(args.buyerContact!==undefined)patch.buyerContact=args.buyerContact;
      if(!Object.keys(patch).length)return {ok:false,error:'未提供任何更新字段'};
      const after=Object.assign(_snap(before),patch);
      return {ok:true,preview:{before,after,patch}};
    },
    add_order_item(args){
      const o=DB.orders.find(x=>x.id===args.orderId);
      if(!o)return {ok:false,error:'订单不存在：'+args.orderId};
      if(!String(args.name||'').trim())return {ok:false,error:'产品名称不能为空'};
      if(!(Number(args.qty)>0))return {ok:false,error:'数量必须 > 0'};
      const after={id:'(自动生成)',name:args.name,spec:args.spec||'',qty:args.qty,salePrice:args.salePrice||0,quotePrice:args.quotePrice||0,bomSku:args.bomSku||'',usage:args.usage||'',remark:args.remark||''};
      return {ok:true,preview:{after}};
    },
    update_order_item(args){
      const o=DB.orders.find(x=>x.id===args.orderId);
      if(!o)return {ok:false,error:'订单不存在：'+args.orderId};
      const idx=(o.items||[]).findIndex(it=>it.id===args.itemId);
      if(idx<0)return {ok:false,error:'明细不存在：'+args.itemId};
      const it=o.items[idx];
      const before=_snap({id:it.id,name:it.name,spec:it.spec,qty:it.qty,salePrice:it.salePrice,quotePrice:it.quotePrice,usage:it.usage,remark:it.remark});
      const patch={};
      ['name','spec','usage','remark'].forEach(k=>{if(args[k]!==undefined)patch[k]=args[k];});
      if(args.qty!==undefined){if(!(Number(args.qty)>0))return {ok:false,error:'数量必须 > 0'};patch.qty=Number(args.qty);}
      if(args.salePrice!==undefined)patch.salePrice=Number(args.salePrice);
      if(args.quotePrice!==undefined)patch.quotePrice=Number(args.quotePrice);
      if(!Object.keys(patch).length)return {ok:false,error:'未提供任何更新字段'};
      const after=Object.assign(_snap(before),patch);
      return {ok:true,preview:{before,after,patch}};
    },
    remove_order_item(args){
      const o=DB.orders.find(x=>x.id===args.orderId);
      if(!o)return {ok:false,error:'订单不存在：'+args.orderId};
      const it=(o.items||[]).find(x=>x.id===args.itemId);
      if(!it)return {ok:false,error:'明细不存在：'+args.itemId};
      return {ok:true,preview:{orderId:o.id,itemId:args.itemId,name:it.name||'',spec:it.spec||''}};
    },
    assign_supplier(args){
      const o=DB.orders.find(x=>x.id===args.orderId);
      if(!o)return {ok:false,error:'订单不存在：'+args.orderId};
      const it=(o.items||[]).find(x=>x.id===args.itemId);
      if(!it)return {ok:false,error:'明细不存在：'+args.itemId};
      const p=DB.prices.find(x=>x.id===args.priceId);
      if(!p)return {ok:false,error:'报价不存在：'+args.priceId};
      if(!(Number(args.allocQty)>0))return {ok:false,error:'分配数量必须 > 0'};
      const allocSum=(it.options||[]).filter(opt=>opt.status!=='已移除').reduce((s,opt)=>s+(Number(opt.allocQty)||0),0);
      const remain=Number(it.qty||0)-allocSum;
      if(args.allocQty>remain)return {ok:false,error:'分配数量超出剩余量 '+fmtN(remain)};
      if((it.options||[]).some(opt=>opt.supplierId===p.unitId))return {ok:false,error:'该供应商已分配，请勿重复'};
      const u=DB.units.find(x=>x.id===p.unitId);
      return {ok:true,preview:{orderId:o.id,itemId:args.itemId,itemName:it.name,priceId:args.priceId,supplierName:u?u.name:p.unitId,price:p.price,allocQty:args.allocQty,remain}};
    },
    add_manual_supplier(args){
      const o=DB.orders.find(x=>x.id===args.orderId);
      if(!o)return {ok:false,error:'订单不存在：'+args.orderId};
      const it=(o.items||[]).find(x=>x.id===args.itemId);
      if(!it)return {ok:false,error:'明细不存在：'+args.itemId};
      if(!String(args.unitName||'').trim())return {ok:false,error:'供应商名称不能为空'};
      if(!(Number(args.price)>0))return {ok:false,error:'采购单价必须 > 0'};
      if(!(Number(args.allocQty)>0))return {ok:false,error:'分配数量必须 > 0'};
      const allocSum=(it.options||[]).filter(opt=>opt.status!=='已移除').reduce((s,opt)=>s+(Number(opt.allocQty)||0),0);
      const remain=Number(it.qty||0)-allocSum;
      if(args.allocQty>remain)return {ok:false,error:'分配数量超出剩余量 '+fmtN(remain)};
      return {ok:true,preview:{orderId:o.id,itemId:args.itemId,itemName:it.name,unitName:args.unitName,price:args.price,allocQty:args.allocQty,remain}};
    },
    remove_sourcing_option(args){
      const o=DB.orders.find(x=>x.id===args.orderId);
      if(!o)return {ok:false,error:'订单不存在：'+args.orderId};
      const it=(o.items||[]).find(x=>x.id===args.itemId);
      if(!it)return {ok:false,error:'明细不存在：'+args.itemId};
      const opt=(it.options||[]).find(x=>x.id===args.optionId);
      if(!opt)return {ok:false,error:'分配记录不存在：'+args.optionId};
      const u=DB.units.find(x=>x.id===opt.supplierId);
      return {ok:true,preview:{orderId:o.id,itemId:args.itemId,optionId:args.optionId,supplierName:u?u.name:opt.supplierId,allocQty:opt.allocQty}};
    },
    // ===== 阶段3：结算/发票写入校验 =====
    create_settlement(args){
      if(!['receipt','payment'].includes(args.type))return {ok:false,error:'type 取值非法'};
      const u=DB.units.find(x=>x.id===args.unitId);
      if(!u)return {ok:false,error:'单位不存在：'+args.unitId};
      if(!String(args.date||'').trim())return {ok:false,error:'日期不能为空'};
      if(!(Number(args.amount)>0))return {ok:false,error:'金额必须 > 0'};
      const after={id:'(自动生成)',type:args.type,unitId:args.unitId,unitName:u.name,date:args.date,amount:args.amount,person:args.person||'',note:args.note||'',orders:args.orders||[]};
      return {ok:true,preview:{after}};
    },
    update_settlement(args){
      const s=DB.settlements.find(x=>x.id===args.settleId);
      if(!s)return {ok:false,error:'结算记录不存在：'+args.settleId};
      const before=_snap({date:s.date,amount:s.amount,person:s.person,note:s.note});
      const patch={};
      if(args.date!==undefined)patch.date=args.date;
      if(args.amount!==undefined){if(!(Number(args.amount)>0))return {ok:false,error:'金额必须 > 0'};patch.amount=Number(args.amount);}
      if(args.person!==undefined)patch.person=args.person;
      if(args.note!==undefined)patch.note=args.note;
      if(!Object.keys(patch).length)return {ok:false,error:'未提供任何更新字段'};
      const after=Object.assign(_snap(before),patch);
      return {ok:true,preview:{before,after,patch}};
    },
    create_invoice(args){
      if(!['issue','receive'].includes(args.type))return {ok:false,error:'type 取值非法'};
      const u=DB.units.find(x=>x.id===args.unitId);
      if(!u)return {ok:false,error:'单位不存在：'+args.unitId};
      if(!String(args.date||'').trim())return {ok:false,error:'日期不能为空'};
      if(!(Number(args.amount)>0))return {ok:false,error:'金额必须 > 0'};
      const after={id:'(自动生成)',type:args.type,unitId:args.unitId,unitName:u.name,date:args.date,amount:args.amount,remark:args.remark||''};
      return {ok:true,preview:{after}};
    },
    update_invoice(args){
      const inv=DB.invoices.find(x=>x.id===args.invoiceId);
      if(!inv)return {ok:false,error:'发票不存在：'+args.invoiceId};
      const before=_snap({date:inv.date,amount:inv.amount,remark:inv.remark});
      const patch={};
      if(args.date!==undefined)patch.date=args.date;
      if(args.amount!==undefined){if(!(Number(args.amount)>0))return {ok:false,error:'金额必须 > 0'};patch.amount=Number(args.amount);}
      if(args.remark!==undefined)patch.remark=args.remark;
      if(!Object.keys(patch).length)return {ok:false,error:'未提供任何更新字段'};
      const after=Object.assign(_snap(before),patch);
      return {ok:true,preview:{before,after,patch}};
    },
    // ===== 阶段3：删除类校验（引用检查） =====
    delete_unit(args){
      const u=DB.units.find(x=>x.id===args.unitId);
      if(!u)return {ok:false,error:'单位不存在：'+args.unitId};
      const refs=[];
      if(DB.orders.some(o=>o.buyerId===args.unitId))refs.push('订单（采购商）');
      if(DB.prices.some(p=>p.unitId===args.unitId))refs.push('报价');
      if(DB.settlements.some(s=>s.unitId===args.unitId))refs.push('结算');
      return {ok:true,preview:{unitId:args.unitId,name:u.name,refs}};
    },
    delete_bom(args){
      const b=DB.bom.find(x=>x.id===args.bomId);
      if(!b)return {ok:false,error:'BOM 不存在：'+args.bomId};
      return {ok:true,preview:{bomId:args.bomId,sku:b.sku,name:b.name}};
    },
    delete_price(args){
      const p=DB.prices.find(x=>x.id===args.priceId);
      if(!p)return {ok:false,error:'报价不存在：'+args.priceId};
      return {ok:true,preview:{priceId:args.priceId,unitName:unitNameSafe(p.unitId),spec:p.spec||p.bomSku}};
    },
    delete_order(args){
      const o=DB.orders.find(x=>x.id===args.orderId);
      if(!o)return {ok:false,error:'订单不存在：'+args.orderId};
      return {ok:true,preview:{orderId:args.orderId,buyer:unitNameSafe(o.buyerId),status:o.status,items:(o.items||[]).length}};
    },
    delete_spec_value(args){
      if(!['type','standard','diameter','hardness','surface','material'].includes(args.dimension))return {ok:false,error:'dimension 取值非法'};
      if(!(DB.specs[args.dimension]||[]).includes(args.value))return {ok:false,error:'枚举值不存在：'+args.dimension+'/'+args.value};
      return {ok:true,preview:{dimension:args.dimension,value:args.value}};
    },
    delete_settlement(args){
      const s=DB.settlements.find(x=>x.id===args.settleId);
      if(!s)return {ok:false,error:'结算记录不存在：'+args.settleId};
      return {ok:true,preview:{settleId:args.settleId,type:s.type,unitName:unitNameSafe(s.unitId),amount:s.amount}};
    },
    delete_invoice(args){
      const inv=DB.invoices.find(x=>x.id===args.invoiceId);
      if(!inv)return {ok:false,error:'发票不存在：'+args.invoiceId};
      return {ok:true,preview:{invoiceId:args.invoiceId,type:inv.type,unitName:inv.unitName||unitNameSafe(inv.unitId),amount:inv.amount}};
    },
    // ===== 阶段4：功能层工具校验（轻量校验，仅确认目标存在） =====
    navigate_view(args){
      const VIEWS=['dashboard','units','specs','bom','prices','orders','settlements','invoices','data'];
      if(!VIEWS.includes(args.viewName))return {ok:false,error:'viewName 取值非法：'+args.viewName};
      if(args.orderId&&args.viewName!=='orders')return {ok:false,error:'orderId 仅在 viewName=orders 时生效'};
      if(args.orderId){
        const o=DB.orders.find(x=>x.id===args.orderId);
        if(!o)return {ok:false,error:'订单不存在：'+args.orderId};
      }
      return {ok:true,preview:{viewName:args.viewName,orderId:args.orderId||''}};
    },
    export_order_excel(args){
      const o=DB.orders.find(x=>x.id===args.orderId);
      if(!o)return {ok:false,error:'订单不存在：'+args.orderId};
      return {ok:true,preview:{orderId:o.id,buyer:unitNameSafe(o.buyerId),status:o.status}};
    },
    open_settlement_drawer(args){
      const u=DB.units.find(x=>x.id===args.unitId);
      if(!u)return {ok:false,error:'单位不存在：'+args.unitId};
      const tabType=args.tabType||'receipt';
      if(!['receipt','payment'].includes(tabType))return {ok:false,error:'tabType 取值非法'};
      return {ok:true,preview:{unitId:args.unitId,unitName:u.name,tabType}};
    },
    open_invoice_drawer(args){
      const inv=DB.invoices.find(x=>x.id===args.invoiceId);
      if(!inv)return {ok:false,error:'发票不存在：'+args.invoiceId};
      return {ok:true,preview:{invoiceId:args.invoiceId,type:inv.type,unitName:inv.unitName||unitNameSafe(inv.unitId),amount:inv.amount}};
    }
  };

  /** 工具执行器：name → (args, ctx) → {ok,error,summary,opRecord}
   * ctx: {aiChatId, batchId, operator} */
  const executors={
    create_unit(args,ctx){
      const u={id:uid('U'),name:String(args.name).trim(),roles:args.roles,rating:args.rating||'',term:args.term||'',contacts:[],invoice:{},createdAt:today()};
      // 敏感字段落库（确认弹窗补全后并入 args）
      const sPhone=String(args.phone||'').trim();
      const sName=String(args.contactName||'').trim();
      if(sPhone||sName)u.contacts.push({name:sName,phone:sPhone,side:'供应',sides:['供应']});
      if(args.taxId||args.address||args.bank||args.accountNo){
        u.invoice={taxId:String(args.taxId||'').trim(),address:String(args.address||'').trim(),phone:String(args.phone||'').trim(),bank:String(args.bank||'').trim(),accountNo:String(args.accountNo||'').trim()};
      }
      DB.units.push(u);
      saveDB();
      const op=recordAiOp({op:'create',type:'unit',targetId:u.id,before:null,after:_snap(u),batchId:ctx.batchId,operator:ctx.operator||'ai',aiChatId:ctx.aiChatId});
      return {ok:true,summary:'已新增单位「'+u.name+'」（'+u.roles.join('/')+'）',opRecord:op};
    },
    update_unit(args,ctx){
      const u=DB.units.find(x=>x.id===args.unitId);
      const before=_snap(u);
      const patch=Object.assign({},args);delete patch.unitId;
      Object.assign(u,patch);
      saveDB();
      const op=recordAiOp({op:'update',type:'unit',targetId:u.id,before,after:_snap(u),batchId:ctx.batchId,operator:ctx.operator||'ai',aiChatId:ctx.aiChatId});
      return {ok:true,summary:'已修改单位「'+u.name+'」',opRecord:op};
    },
    create_price(args,ctx){
      const p={id:uid('PR'),unitId:args.unitId,bomSku:args.bomSku||'',spec:args.spec||'',type:args.type||'',standard:args.standard||'',diameter:args.diameter||'',hardness:args.hardness||'',surface:args.surface||'',material:args.material||'',price:Number(args.price),validFrom:args.validFrom||today(),contact:args.contact||'',remark:args.remark||'',createdAt:today()};
      DB.prices.push(p);
      saveDB();
      const op=recordAiOp({op:'create',type:'price',targetId:p.id,before:null,after:_snap(p),batchId:ctx.batchId,operator:ctx.operator||'ai',aiChatId:ctx.aiChatId});
      const u=DB.units.find(x=>x.id===args.unitId);
      return {ok:true,summary:'已新增报价「'+(u?u.name:args.unitId)+' '+(p.spec||p.bomSku)+'」¥'+p.price,opRecord:op};
    },
    update_price(args,ctx){
      const p=DB.prices.find(x=>x.id===args.priceId);
      const before=_snap(p);
      const patch=Object.assign({},args);delete patch.priceId;
      Object.assign(p,patch);
      saveDB();
      const op=recordAiOp({op:'update',type:'price',targetId:p.id,before,after:_snap(p),batchId:ctx.batchId,operator:ctx.operator||'ai',aiChatId:ctx.aiChatId});
      return {ok:true,summary:'已修改报价 '+p.id,opRecord:op};
    },
    flow_order_status(args,ctx){
      const o=DB.orders.find(x=>x.id===args.orderId);
      const before={status:o.status};
      o.status=args.toStatus;
      o.statusChangedAt=now();
      saveDB();
      const op=recordAiOp({op:'flow',type:'order',targetId:o.id,before,after:{status:args.toStatus},batchId:ctx.batchId,operator:ctx.operator||'ai',aiChatId:ctx.aiChatId});
      return {ok:true,summary:'订单 '+o.id+' 流转：'+before.status+' → '+args.toStatus,opRecord:op};
    },
    // ===== 阶段3：BOM/属性写入执行器 =====
    create_bom(args,ctx){
      const b={id:uid('B'),sku:String(args.sku).trim(),name:args.name,spec:args.spec||'',type:args.type||'',standard:args.standard||'',diameter:args.diameter||'',hardness:args.hardness||'',surface:args.surface||'',material:args.material||'',createdAt:today()};
      DB.bom.push(b);
      saveDB();
      const op=recordAiOp({op:'create',type:'bom',targetId:b.id,before:null,after:_snap(b),batchId:ctx.batchId,operator:ctx.operator||'ai',aiChatId:ctx.aiChatId});
      return {ok:true,summary:'已新增 BOM「'+b.sku+' '+b.name+'」',opRecord:op};
    },
    update_bom(args,ctx){
      const b=DB.bom.find(x=>x.id===args.bomId);
      const before=_snap(b);
      const patch=Object.assign({},args);delete patch.bomId;
      Object.assign(b,patch);
      saveDB();
      const op=recordAiOp({op:'update',type:'bom',targetId:b.id,before,after:_snap(b),batchId:ctx.batchId,operator:ctx.operator||'ai',aiChatId:ctx.aiChatId});
      return {ok:true,summary:'已修改 BOM '+b.sku,opRecord:op};
    },
    set_spec_value(args,ctx){
      if(!Array.isArray(DB.specs[args.dimension]))DB.specs[args.dimension]=[];
      if(DB.specs[args.dimension].includes(args.value)){
        return {ok:true,summary:'属性值已存在，跳过：'+args.dimension+'/'+args.value,opRecord:null};
      }
      const before=_snap(DB.specs[args.dimension]);
      DB.specs[args.dimension].push(args.value);
      saveDB();
      const op=recordAiOp({op:'create',type:'spec',targetId:args.dimension+':'+args.value,before,after:_snap(DB.specs[args.dimension]),batchId:ctx.batchId,operator:ctx.operator||'ai',aiChatId:ctx.aiChatId});
      return {ok:true,summary:'已新增属性值 '+args.dimension+'/'+args.value,opRecord:op};
    },
    // ===== 阶段3：订单复杂操作执行器 =====
    create_order(args,ctx){
      const items=(args.items||[]).map(it=>({
        id:uid('OI'),sku:it.sku||'',name:it.name,spec:it.spec||'',qty:Number(it.qty),
        salePrice:Number(it.salePrice)||0,quotePrice:Number(it.quotePrice)||0,
        bomSku:it.bomSku||'',usage:it.usage||'',remark:it.remark||'',options:[]
      }));
      const o={id:uid('O'),buyerId:args.buyerId,buyerContact:args.buyerContact||'',project:args.project||'',delivery:{date:args.deliveryDate||'',time:args.deliveryDate||'',address:''},items,status:'待确认',statusChangedAt:now(),createdAt:now(),updatedAt:now()};
      DB.orders.push(o);
      saveDB();
      const op=recordAiOp({op:'create',type:'order',targetId:o.id,before:null,after:_snap(o),batchId:ctx.batchId,operator:ctx.operator||'ai',aiChatId:ctx.aiChatId});
      return {ok:true,summary:'已新建订单 '+o.id+'（采购商：'+unitNameSafe(o.buyerId)+'，'+items.length+' 项明细）',opRecord:op};
    },
    update_order_meta(args,ctx){
      const o=DB.orders.find(x=>x.id===args.orderId);
      const before=_snap({buyerId:o.buyerId,project:o.project,deliveryDate:(o.delivery&&(o.delivery.date||o.delivery.time))||'',buyerContact:o.buyerContact});
      if(args.buyerId!==undefined)o.buyerId=args.buyerId;
      if(args.project!==undefined)o.project=args.project;
      if(args.deliveryDate!==undefined){o.delivery=o.delivery||{};o.delivery.date=args.deliveryDate;o.delivery.time=args.deliveryDate;}
      if(args.buyerContact!==undefined)o.buyerContact=args.buyerContact;
      o.updatedAt=now();
      saveDB();
      const op=recordAiOp({op:'update',type:'order',targetId:o.id,before,after:_snap({buyerId:o.buyerId,project:o.project,deliveryDate:(o.delivery&&(o.delivery.date||o.delivery.time))||'',buyerContact:o.buyerContact}),batchId:ctx.batchId,operator:ctx.operator||'ai',aiChatId:ctx.aiChatId});
      return {ok:true,summary:'已修改订单 '+o.id+' 元信息',opRecord:op};
    },
    add_order_item(args,ctx){
      const o=DB.orders.find(x=>x.id===args.orderId);
      const it={id:uid('OI'),sku:args.sku||'',name:args.name,spec:args.spec||'',qty:Number(args.qty),salePrice:Number(args.salePrice)||0,quotePrice:Number(args.quotePrice)||0,bomSku:args.bomSku||'',usage:args.usage||'',remark:args.remark||'',options:[]};
      o.items=o.items||[];o.items.push(it);o.updatedAt=now();
      saveDB();
      const op=recordAiOp({op:'create',type:'order_item',targetId:it.id,before:null,after:_snap(it),batchId:ctx.batchId,operator:ctx.operator||'ai',aiChatId:ctx.aiChatId});
      return {ok:true,summary:'已向订单 '+o.id+' 追加明细「'+it.name+'」',opRecord:op};
    },
    update_order_item(args,ctx){
      const o=DB.orders.find(x=>x.id===args.orderId);
      const it=(o.items||[]).find(x=>x.id===args.itemId);
      const before=_snap(it);
      const patch=Object.assign({},args);delete patch.orderId;delete patch.itemId;
      Object.assign(it,patch);o.updatedAt=now();
      saveDB();
      const op=recordAiOp({op:'update',type:'order_item',targetId:it.id,before,after:_snap(it),batchId:ctx.batchId,operator:ctx.operator||'ai',aiChatId:ctx.aiChatId});
      return {ok:true,summary:'已修改明细 '+it.name,opRecord:op};
    },
    remove_order_item(args,ctx){
      // 走 softDeleteOrderItem（阶段1 已实现）
      const res=softDeleteOrderItem(args.orderId,args.itemId,{operator:ctx.operator||'ai',batchId:ctx.batchId,aiChatId:ctx.aiChatId});
      return {ok:true,summary:'已移除明细（可从回收站恢复）',opRecord:res.trashEntry};
    },
    assign_supplier(args,ctx){
      const o=DB.orders.find(x=>x.id===args.orderId);
      const it=(o.items||[]).find(x=>x.id===args.itemId);
      const p=DB.prices.find(x=>x.id===args.priceId);
      const before=_snap(it);
      it.options=it.options||[];
      it.options.push({id:uid('Q'),supplierId:p.unitId,contact:p.contact||'',price:p.price,allocQty:Number(args.allocQty),stockNote:'有效期:'+p.validFrom,source:'priceLibrary',status:'已选'});
      o.updatedAt=now();
      saveDB();
      const op=recordAiOp({op:'update',type:'order_item',targetId:it.id,before,after:_snap(it),batchId:ctx.batchId,operator:ctx.operator||'ai',aiChatId:ctx.aiChatId});
      return {ok:true,summary:'已分配供应商 '+unitNameSafe(p.unitId)+' · '+fmtN(args.allocQty)+' @ ¥'+p.price,opRecord:op};
    },
    add_manual_supplier(args,ctx){
      const o=DB.orders.find(x=>x.id===args.orderId);
      const it=(o.items||[]).find(x=>x.id===args.itemId);
      // 查找或创建关联单位（复用 manualSupplier 逻辑）
      let unit=DB.units.find(u=>u.name===args.unitName);
      if(!unit){
        unit={id:uid('U'),name:args.unitName,roles:['供应商'],rating:'',term:'',contacts:[],invoice:{},createdAt:today()};
        if(args.contact)unit.contacts.push({name:args.contact,phone:'',side:'供应',sides:['供应']});
        DB.units.push(unit);
      }
      // 同步价格库（与 manualSupplier 一致）
      const price={id:uid('PR'),unitId:unit.id,bomSku:it.bomSku||'',spec:it.spec||'',type:it.type||'',standard:it.standard||'',diameter:it.diameter||'',hardness:it.hardness||'',surface:it.surface||'',material:it.material||'',price:Number(args.price),validFrom:today(),contact:args.contact||'',remark:'AI 手动录入',createdAt:today()};
      DB.prices.push(price);
      // 添加寻货分配
      const before=_snap(it);
      it.options=it.options||[];
      it.options.push({id:uid('Q'),supplierId:unit.id,contact:args.contact||'',price:Number(args.price),allocQty:Number(args.allocQty),stockNote:args.stockNote||'手动录入',source:'manual',status:'已选'});
      o.updatedAt=now();
      saveDB();
      const op=recordAiOp({op:'update',type:'order_item',targetId:it.id,before,after:_snap(it),batchId:ctx.batchId,operator:ctx.operator||'ai',aiChatId:ctx.aiChatId});
      return {ok:true,summary:'已手动录入供应商 '+unit.name+' · '+fmtN(args.allocQty)+' @ ¥'+args.price,opRecord:op};
    },
    remove_sourcing_option(args,ctx){
      const o=DB.orders.find(x=>x.id===args.orderId);
      const it=(o.items||[]).find(x=>x.id===args.itemId);
      const before=_snap(it);
      it.options=(it.options||[]).filter(opt=>opt.id!==args.optionId);
      o.updatedAt=now();
      saveDB();
      const op=recordAiOp({op:'update',type:'order_item',targetId:it.id,before,after:_snap(it),batchId:ctx.batchId,operator:ctx.operator||'ai',aiChatId:ctx.aiChatId});
      return {ok:true,summary:'已移除寻货分配 '+args.optionId,opRecord:op};
    },
    // ===== 阶段3：结算/发票写入执行器 =====
    create_settlement(args,ctx){
      const s={id:uid('ST'),type:args.type,unitId:args.unitId,date:args.date,amount:Number(args.amount),person:args.person||'',note:args.note||'',orders:args.orders||[],createdAt:now()};
      DB.settlements.push(s);
      saveDB();
      const op=recordAiOp({op:'create',type:'settlement',targetId:s.id,before:null,after:_snap(s),batchId:ctx.batchId,operator:ctx.operator||'ai',aiChatId:ctx.aiChatId});
      return {ok:true,summary:'已新增结算 '+s.id+'（'+(args.type==='receipt'?'应收':'应付')+' ¥'+fmt(s.amount)+'）',opRecord:op};
    },
    update_settlement(args,ctx){
      const s=DB.settlements.find(x=>x.id===args.settleId);
      const before=_snap(s);
      const patch=Object.assign({},args);delete patch.settleId;
      Object.assign(s,patch);
      saveDB();
      const op=recordAiOp({op:'update',type:'settlement',targetId:s.id,before,after:_snap(s),batchId:ctx.batchId,operator:ctx.operator||'ai',aiChatId:ctx.aiChatId});
      return {ok:true,summary:'已修改结算 '+s.id,opRecord:op};
    },
    create_invoice(args,ctx){
      const u=DB.units.find(x=>x.id===args.unitId);
      const inv={id:uid('INV'),type:args.type,unitId:args.unitId,unitName:u?u.name:args.unitId,date:args.date,amount:Number(args.amount),remark:args.remark||'',invoiceStatus:args.type==='issue'?'已开票':'已收票',receiveStatus:args.type==='receive'?'已收票':'未收票',createdAt:now()};
      DB.invoices.push(inv);
      saveDB();
      const op=recordAiOp({op:'create',type:'invoice',targetId:inv.id,before:null,after:_snap(inv),batchId:ctx.batchId,operator:ctx.operator||'ai',aiChatId:ctx.aiChatId});
      return {ok:true,summary:'已新增发票 '+inv.id+'（¥'+fmt(inv.amount)+'）',opRecord:op};
    },
    update_invoice(args,ctx){
      const inv=DB.invoices.find(x=>x.id===args.invoiceId);
      const before=_snap(inv);
      const patch=Object.assign({},args);delete patch.invoiceId;
      Object.assign(inv,patch);
      saveDB();
      const op=recordAiOp({op:'update',type:'invoice',targetId:inv.id,before,after:_snap(inv),batchId:ctx.batchId,operator:ctx.operator||'ai',aiChatId:ctx.aiChatId});
      return {ok:true,summary:'已修改发票 '+inv.id,opRecord:op};
    },
    // ===== 阶段3：删除类执行器（走 softDelete） =====
    delete_unit(args,ctx){
      const res=softDelete('unit',args.unitId,{operator:ctx.operator||'ai',batchId:ctx.batchId,aiChatId:ctx.aiChatId});
      return {ok:true,summary:'已删除单位（可从回收站恢复）',opRecord:res.op};
    },
    delete_bom(args,ctx){
      const res=softDelete('bom',args.bomId,{operator:ctx.operator||'ai',batchId:ctx.batchId,aiChatId:ctx.aiChatId});
      return {ok:true,summary:'已删除 BOM（可从回收站恢复）',opRecord:res.op};
    },
    delete_price(args,ctx){
      const res=softDelete('price',args.priceId,{operator:ctx.operator||'ai',batchId:ctx.batchId,aiChatId:ctx.aiChatId});
      return {ok:true,summary:'已删除报价（可从回收站恢复）',opRecord:res.op};
    },
    delete_order(args,ctx){
      const res=softDelete('order',args.orderId,{operator:ctx.operator||'ai',batchId:ctx.batchId,aiChatId:ctx.aiChatId});
      return {ok:true,summary:'已删除订单（可从回收站恢复）',opRecord:res.op};
    },
    delete_spec_value(args,ctx){
      const res=softDeleteSpecOption(args.dimension,args.value,{operator:ctx.operator||'ai',batchId:ctx.batchId,aiChatId:ctx.aiChatId});
      return {ok:true,summary:'已删除属性值 '+args.dimension+'/'+args.value+'（可从回收站恢复）',opRecord:res.trashEntry};
    },
    delete_settlement(args,ctx){
      const res=softDelete('settlement',args.settleId,{operator:ctx.operator||'ai',batchId:ctx.batchId,aiChatId:ctx.aiChatId});
      return {ok:true,summary:'已删除结算（可从回收站恢复）',opRecord:res.op};
    },
    delete_invoice(args,ctx){
      const res=softDelete('invoice',args.invoiceId,{operator:ctx.operator||'ai',batchId:ctx.batchId,aiChatId:ctx.aiChatId});
      return {ok:true,summary:'已删除发票（可从回收站恢复）',opRecord:res.op};
    }
  };

  /** 单条校验入口（执行前脏读检查可选，本轮暂略） */
  function validateOp(op){
    const v=validators[op.name];
    if(!v)return {ok:false,error:'未知工具：'+op.name};
    try{return v(op.args||{});}
    catch(e){return {ok:false,error:'校验异常：'+e.message};}
  }

  /** 阶段4：并发脏读检测 —— 对比弹窗确认时的 before 指纹与当前 before
   *  @param {object} op - 操作对象（含 __beforeFingerprint）
   *  @returns {{ok:boolean,error?:string,currentBefore?:object}}
   *  - 仅对携带 __beforeFingerprint 的 update/delete 类工具生效
   *  - create/flow/query 类无 before，跳过检测
   */
  function _checkDirty(op){
    const expected=op.__beforeFingerprint;
    if(!expected)return {ok:true}; // 无指纹（create/flow/query 类），跳过检测
    // 重新校验当前数据，拿最新 before
    const v=validateOp(op);
    if(!v.ok)return {ok:false,error:'校验失败：'+v.error};
    const before=(v.preview&&v.preview.before!==undefined)?v.preview.before:null;
    if(before===null)return {ok:true,currentBefore:null}; // 当前工具无 before 概念，跳过
    const currentFingerprint=JSON.stringify(before);
    if(currentFingerprint!==expected){
      return {ok:false,error:'数据已被修改，请刷新后重试',currentBefore:before};
    }
    return {ok:true,currentBefore:before};
  }

  /** 单条执行入口（已校验通过）
   *  阶段4：单独调用时做并发脏读检测（对比 __beforeFingerprint 与当前 before）
   *  批量入口（executeOps）通过 ctx.inBatch=true 跳过检测，避免批量内顺序修改误报
   */
  function executeOp(op,ctx){
    const ex=executors[op.name];
    if(!ex)return {ok:false,error:'未知工具：'+op.name};
    const c=ctx||{};
    // 阶段4：并发脏读检测 —— 仅单独调用时生效，批量内跳过
    if(op.__beforeFingerprint&&!c.inBatch){
      const dirty=_checkDirty(op);
      if(!dirty.ok)return {ok:false,error:dirty.error};
    }
    try{return ex(op.args||{},c);}
    catch(e){return {ok:false,error:'执行异常：'+e.message};}
  }

  /** 批量执行入口（逐条校验+执行，单条失败不中断其他）
   *  阶段4：批量入口跳过 _checkDirty，因为批量内前序 op 修改后续 op 涉及数据是预期顺序执行
   *  批量入口的并发安全由 validateOp 重新校验保障（执行前再读一次最新数据）
   */
  function executeOps(ops,ctx){
    const batchId=(ctx&&ctx.batchId)||uid('AOB');
    const results=[];
    for(let i=0;i<ops.length;i++){
      const op=ops[i];
      const v=validateOp(op);
      if(!v.ok){results.push({index:i,ok:false,error:v.error,summary:'校验失败'});continue;}
      const r=executeOp(op,{aiChatId:ctx&&ctx.aiChatId,batchId,operator:(ctx&&ctx.operator)||'ai',inBatch:true});
      results.push({index:i,ok:r.ok,error:r.error,summary:r.summary,opRecord:r.opRecord});
    }
    return {batchId,results};
  }

  /** 安全取单位名（不存在返回 ID） */
  function unitNameSafe(id){const u=DB.units.find(x=>x.id===id);return u?u.name:(id||'未知');}

  /** 功能层工具执行入口（自动执行，不经确认弹窗；触发 UI 动作，不写 DB）
   *  仅处理 FLOW_TOOL_NAMES 中的工具，返回 JSON 字符串供回填给模型。
   *  @param {string} name - 工具名
   *  @param {object} args - 工具参数
   *  @returns {string} - JSON 字符串（{ok,message,...}）
   */
  function runFlow(name,args){
    args=args||{};
    try{
      // 先做轻量校验（复用 validators），失败直接返回，不触发 UI
      const v=validateOp({name:name,args:args});
      if(!v.ok)return JSON.stringify({ok:false,error:v.error});

      if(name==='navigate_view'){
        const viewName=args.viewName;
        const orderId=args.orderId;
        if(typeof go!=='function')return JSON.stringify({ok:false,error:'go() 未加载'});
        if(orderId&&viewName==='orders'){
          if(typeof goOrderView==='function')goOrderView(orderId);
          else return JSON.stringify({ok:false,error:'goOrderView() 未加载'});
          return JSON.stringify({ok:true,message:'已导航到订单详情：'+orderId});
        }
        go(viewName);
        return JSON.stringify({ok:true,message:'已导航到视图：'+viewName});
      }
      if(name==='export_order_excel'){
        if(typeof exportOrder!=='function')return JSON.stringify({ok:false,error:'exportOrder() 未加载'});
        // 异步导出，不阻塞对话流；用 Promise.then 容错，错误通过 toast 反馈
        const orderId=args.orderId;
        Promise.resolve().then(()=>exportOrder(orderId)).catch(e=>{
          if(typeof toast==='function')toast('导出失败：'+e.message,'error');
        });
        return JSON.stringify({ok:true,message:'已触发 Excel 导出：'+orderId});
      }
      if(name==='open_settlement_drawer'){
        if(typeof openSettleDetail!=='function')return JSON.stringify({ok:false,error:'openSettleDetail() 未加载'});
        const tabType=args.tabType||'receipt';
        openSettleDetail(args.unitId,tabType);
        return JSON.stringify({ok:true,message:'已打开结算抽屉：'+unitNameSafe(args.unitId)+' / '+tabType});
      }
      if(name==='open_invoice_drawer'){
        if(typeof openInvEdit!=='function')return JSON.stringify({ok:false,error:'openInvEdit() 未加载'});
        openInvEdit(args.invoiceId);
        return JSON.stringify({ok:true,message:'已打开发票抽屉：'+args.invoiceId});
      }
      return JSON.stringify({ok:false,error:'未知功能层工具：'+name});
    }catch(e){
      return JSON.stringify({ok:false,error:'功能层执行异常：'+e.message});
    }
  }

  /** 查询类工具执行入口（自动执行，不经确认弹窗；返回脱敏 JSON 字符串供回填给模型）
   *  @param {string} name - 工具名（query_*）
   *  @param {object} args - 工具参数
   *  @returns {string} - 脱敏 JSON 字符串
   */
  function runQuery(name,args){
    args=args||{};
    try{
      if(name==='query_units'){
        let list=DB.units.slice();
        if(args.keyword)list=list.filter(u=>(u.name||'').includes(args.keyword));
        if(args.role)list=list.filter(u=>(u.roles||[]).includes(args.role));
        if(args.rating)list=list.filter(u=>u.rating===args.rating);
        // 脱敏：不返回 contacts/invoice（含电话/地址/税号/银行账号）
        const result=list.slice(0,100).map(u=>({id:u.id,name:u.name,roles:u.roles,rating:u.rating,term:u.term}));
        return JSON.stringify({ok:true,count:result.length,items:result});
      }
      if(name==='query_specs'){
        if(args.dimension){
          if(!['type','standard','diameter','hardness','surface','material'].includes(args.dimension))return JSON.stringify({ok:false,error:'dimension 取值非法'});
          return JSON.stringify({ok:true,dimension:args.dimension,values:(DB.specs[args.dimension]||[]).slice()});
        }
        const all={};['type','standard','diameter','hardness','surface','material'].forEach(d=>{all[d]=(DB.specs[d]||[]).slice();});
        return JSON.stringify({ok:true,specs:all});
      }
      if(name==='query_bom'){
        let list=DB.bom.slice();
        if(args.sku)list=list.filter(b=>b.sku===args.sku);
        if(args.keyword)list=list.filter(b=>(b.name||'').includes(args.keyword)||(b.spec||'').includes(args.keyword)||(b.sku||'').includes(args.keyword));
        const result=list.slice(0,200).map(b=>({id:b.id,sku:b.sku,name:b.name,spec:b.spec,type:b.type,standard:b.standard,diameter:b.diameter,hardness:b.hardness,surface:b.surface,material:b.material}));
        return JSON.stringify({ok:true,count:result.length,items:result});
      }
      if(name==='query_prices'){
        let list=DB.prices.slice();
        if(args.unitId)list=list.filter(p=>p.unitId===args.unitId);
        if(args.spec)list=list.filter(p=>(p.spec||'').includes(args.spec));
        // 脱敏：不返回 contact（联系人姓名电话）
        const result=list.slice(0,200).map(p=>({id:p.id,unitId:p.unitId,unitName:unitNameSafe(p.unitId),bomSku:p.bomSku,spec:p.spec,type:p.type,standard:p.standard,diameter:p.diameter,hardness:p.hardness,surface:p.surface,material:p.material,price:p.price,validFrom:p.validFrom}));
        return JSON.stringify({ok:true,count:result.length,items:result});
      }
      if(name==='query_orders'){
        let list=DB.orders.slice();
        if(args.status)list=list.filter(o=>o.status===args.status);
        if(args.keyword)list=list.filter(o=>(o.id||'').includes(args.keyword)||unitNameSafe(o.buyerId).includes(args.keyword)||(o.project||'').includes(args.keyword));
        // 迁移：给无 id 的 item 注入 uid('OI')，保证后续操作有稳定标识
        let migrated=false;
        list.forEach(o=>{
          if(Array.isArray(o.items))o.items.forEach(it=>{if(!it.id){it.id=uid('OI');migrated=true;}});
        });
        if(migrated)saveDB();
        // 脱敏：不返回 delivery.address / buyerContact 电话
        const result=list.slice(0,50).map(o=>{
          const sales=(o.items||[]).reduce((s,it)=>s+((Number(it.salePrice)||0)*(Number(it.qty)||0)),0);
          const cost=(o.items||[]).reduce((s,it)=>s+((it.options||[]).reduce((ss,opt)=>ss+((Number(opt.price)||0)*(Number(opt.allocQty)||0)),0)),0);
          return {
            id:o.id,buyerId:o.buyerId,buyerName:unitNameSafe(o.buyerId),buyerContact:o.buyerContact||'',
            project:o.project||'',deliveryDate:(o.delivery&&(o.delivery.date||o.delivery.time))||'',
            status:o.status,sales:sales,cost:cost,profit:sales-cost,
            items:(o.items||[]).map(it=>({
              id:it.id,name:it.name,spec:it.spec,qty:it.qty,salePrice:it.salePrice,quotePrice:it.quotePrice,
              bomSku:it.bomSku,usage:it.usage,remark:it.remark,
              options:(it.options||[]).map(opt=>({id:opt.id,supplierId:opt.supplierId,supplierName:unitNameSafe(opt.supplierId),price:opt.price,allocQty:opt.allocQty,source:opt.source,status:opt.status}))
            }))
          };
        });
        return JSON.stringify({ok:true,count:result.length,items:result});
      }
      if(name==='query_settlements'){
        let list=DB.settlements.slice();
        if(args.type)list=list.filter(s=>s.type===args.type);
        if(args.unitId)list=list.filter(s=>s.unitId===args.unitId);
        const result=list.slice(0,200).map(s=>({id:s.id,type:s.type,unitId:s.unitId,unitName:unitNameSafe(s.unitId),date:s.date,amount:s.amount,person:s.person,note:s.note,orders:s.orders}));
        return JSON.stringify({ok:true,count:result.length,items:result});
      }
      if(name==='query_invoices'){
        let list=DB.invoices.slice();
        if(args.type)list=list.filter(i=>i.type===args.type);
        if(args.unitId)list=list.filter(i=>i.unitId===args.unitId);
        const result=list.slice(0,200).map(i=>({id:i.id,type:i.type,unitId:i.unitId,unitName:i.unitName||unitNameSafe(i.unitId),date:i.date,amount:i.amount,remark:i.remark,invoiceStatus:i.invoiceStatus,receiveStatus:i.receiveStatus}));
        return JSON.stringify({ok:true,count:result.length,items:result});
      }
      return JSON.stringify({ok:false,error:'未知查询工具：'+name});
    }catch(e){
      return JSON.stringify({ok:false,error:'查询异常：'+e.message});
    }
  }

  /** 工具调用结果回填给模型（脱敏 JSON 摘要） */
  function buildToolResponse(op,result){
    if(!result.ok)return JSON.stringify({ok:false,error:result.error});
    return JSON.stringify({ok:true,summary:result.summary});
  }

  return {
    TOOLS_DEFS,TOOL_META,NEXT_STATUS,FLOW_TOOL_NAMES,
    validateOp,executeOp,executeOps,buildToolResponse,unitNameSafe,runQuery,runFlow
  };
})();
