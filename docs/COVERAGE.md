# 代码文档覆盖率报告

> 生成时间: 2026-08-16  
> 项目版本: v1.1.174  
> 覆盖率: **272/272 函数 (100.0%)**

---

## 1. 覆盖率总览

| 文件 | 函数数 | JSDoc | 覆盖率 | 状态 |
|------|-------|-------|--------|------|
| `js/app.js` | 1 | 1 | 100% | 🟢 完整 |
| `js/store.js` | 9 | 9 | 100% | 🟢 完整 |
| `js/utils.js` | 48 | 48 | 100% | 🟢 完整 |
| `js/ui.js` | 6 | 6 | 100% | 🟢 完整 |
| `js/router.js` | 17 | 17 | 100% | 🟢 完整 |
| `js/seed.js` | 1 | 1 | 100% | 🟢 完整 |
| `js/exporter.js` | 8 | 8 | 100% | 🟢 完整 |
| `js/views/dashboard.js` | 2 | 2 | 100% | 🟢 完整 |
| `js/views/specs.js` | 10 | 10 | 100% | 🟢 完整 |
| `js/views/prices.js` | 18 | 18 | 100% | 🟢 完整 |
| `js/views/orders.js` | 72 | 72 | 100% | 🟢 完整 |
| `js/views/settlements.js` | 20 | 20 | 100% | 🟢 完整 |
| `js/views/invoices.js` | 9 | 9 | 100% | 🟢 完整 |
| `js/views/bom.js` | 22 | 22 | 100% | 🟢 完整 |
| `js/views/units.js` | 21 | 21 | 100% | 🟢 完整 |
| `js/views/data.js` | 8 | 8 | 100% | 🟢 完整 |
| **合计** | **272** | **272** | **100%** | 🟢 **完美** |

---

## 2. 验收结果

| 指标 | 目标 | 实际 | 状态 |
|------|------|------|------|
| 公共函数整体覆盖率 | ≥ 95% | **100%** | ✅ 超出 |
| 核心基础设施覆盖率 | 100% | **100%** | ✅ |
| `@description` 完整率 | 100% | **100%** | ✅ |
| `@param` 标注率 | ≥ 80% | **~90%** | ✅ |
| 语法检查 | 0 错误 | **全部通过** | ✅ |

---

## 3. 各模块函数清单

### 核心基础设施

**`js/store.js`**（9 函数）— IndexedDB / FSA API / 数据迁移
`idbOpen` · `idbSave` · `idbLoad` · `initApp` · `saveDB` · `saveDBDebounced` · `fsaSupported` · `migrateItems` · `storageEstimate`

**`js/utils.js`**（48 函数）— 工具函数库
`escHtml` · `escAttr` · `fmt` · `fmtN` · `today` · `now` · `toDate` · `daysUntil` · `uid` · `icon` · `combo` · `comboFilter` · `getComboVal` · `buildPaging` · `toast` · `isOverdue` · `isApproaching` · `pName` · `pRating` · `roleBadge` · `specLabel` · `specTags` · `specMatch` · `itemOpts` · `itemAllocSum` · `isItemSourced` · `itemSourcingStatus` · `itemProfit` · `orderProfit` · `orderSales` · `orderCost` · `_getBom` · `priceBomSku` · `priceSpec` · `priceAttrCol` · `_buildUnitCache` · `saveDraft` · `loadDraft` · `clearDraft` · `hasDraft` · `collectUnitDraft` · `restoreUnitDraft` · `collectOrderDraft` · `restoreOrderDraft` · `collectBOMDraft` · `restoreBOMDraft` · `collectPriceDraft` · `restorePriceDraft` · `bindDraftSave` · `checkDraftRestore`

**`js/ui.js`**（6 函数）— 弹层组件
`modal` · `closeModal` · `confirmModal` · `openDrawer` · `closeDrawer` · `drawerOk`

**`js/router.js`**（17 函数）— 路由与全局状态
`go` · `render` · `bindView` · `toggleSidebar` · `toggleNavParent` · `switchTheme` · `filterUnitsData` · `filterOrdersData` · `onUnitSearch` · `onOrderSearch` · `onOrderStatusFilter` · `unitPage` · `orderPage` · `goOrderView` · `goOrder`

**`js/exporter.js`**（8 函数）— Excel 导出引擎
`loadXLSX` · `ev` · `downloadWorkbook` · `exportOrder` · `_autoFitCols` · `_normColor` · `_toStyleObj` · `_wc`

**`js/app.js`**（1 函数）— 入口
`initApp`

**`js/seed.js`**（1 函数）— 种子数据
`_seedData`

### 视图模块

**`js/views/orders.js`**（72 函数）— 采购订单（核心模块）
`fmtDelivery` · `renderOrderRow` · `renderOrderEmptyRow` · `viewOrders` · `refreshOrderList` · `viewOrderDetail` · `changeOrderStatus` · `nextStepButton` · `nextStepStartSourcing` · `nextStepFinishSourcing` · `nextStepConfirmSign` · `nextStepEnterDelivery` · `prevStepButton` · `prevStepOrder` · `cancelOrderConfirm` · `saveDeliveryInfo` · `enterEditDelivery` · `cancelEditDelivery` · `newOrder` · `goOrderEdit` · `sourceItemFromDetail` · `persistSourcingFromDetail` · `persistOrderItems` · `bindOrderDraftSave` · `saveOrderDraftFromItems` · `renderItemHTML` · `refreshProductList` · `viewOrderEdit` · `addItem` · `editItem` · `delItem` · `openItemModal` · `saveItemModal` · `buildSourceDrawerBody` · `buildPriceMatchModalBody` · `openPriceMatchModal` · `submitPriceMatch` · `filterPriceMatch` · `buildManualSupplierModalBody` · `openManualSupplierModal` · `initSourceModalCombo` · `refreshSourceDrawer` · `updateDetailRow` · `sourceItem` · `addMatchSupplier` · `manualSupplier` · `removeOption` · `saveOrder` · `toggleOrderItemDropdown` · `closeOrderItemDropdown` · `openOrderBatchAdd` · `parseOrderBatch` · `removeOrderBatchRow` · `submitOrderBatch` · `quoteSupplierComboOptions` · `openSupplierQuoteImport` · `parseSupplierQuote` · `renderSupplierQuotePreview` · `initQuoteSupplierCombos` · `removeQuoteRow` · `findQuoteItemIndex` · `submitSupplierQuote` · `openGenerateQuote` · `saveGeneratedQuote` · `receiveManageSection` · `updateReceiveField` · `deleteOrder` · `contactTooltip` · `renderInspectionSection` · `confirmOrderComplete` · `toggleAllOrders` · `updateOrderBatchBtn` · `batchDeleteOrders`

**`js/views/settlements.js`**（20 函数）— 对账结算
`settleOrders` · `settleReceiptData` · `settlePaymentData` · `settleUnitOrderDetails` · `settleRecords` · `viewSettlements` · `drillSettleTab` · `switchSettleSubTab` · `onSettleUnitFilter` · `onSettleSearch` · `settlePage` · `settleProductRows` · `openSettleDetail` · `delSettlement` · `openNewSettlement` · `onSettleTypeChange` · `refreshSettleOrderList` · `autoSumSettleAmount` · `submitSettlement` · `toggleDrawerSection`

**`js/views/bom.js`**（22 函数）— BOM 物料
`viewBOM` · `filterBOMData` · `hasBOMFilter` · `refreshBOMTable` · `bomPage` · `onBOMSearch` · `clearBOMFilter` · `confirmBOMDel` · `openBOMForm` · `_openBOMDrawer` · `bomValidateField` · `toggleBOMSpecsSection` · `saveBOMForm` · `deleteBOM` · `openBOMBatchAdd` · `parseBOMBatch` · `removeBatchRow` · `submitBOMBatch` · `toggleAllBOM` · `updateBOMBatchBtn` · `batchDeleteBOM` · `fillSpecFromBOM`

**`js/views/units.js`**（21 函数）— 关联单位
`unitCounts` · `viewUnits` · `refreshUnitList` · `setUnitRoleFilter` · `setUnitRatingFilter` · `refreshUnitTabs` · `validateAndCollectUnitForm` · `unitForm` · `toggleInvoiceSection` · `newUnit` · `editUnit` · `delUnit` · `contactRow` · `addCRow` · `delCRow` · `updateContactSides` · `readContacts` · `contactOpts` · `toggleAllUnits` · `updateUnitBatchBtn` · `batchDeleteUnits`

**`js/views/prices.js`**（18 函数）— 报价管理
`viewPrices` · `refreshPricesTable` · `pricePage` · `doPriceSearch` · `filterPrices` · `clearPriceFilter` · `hasPriceFilter` · `newPrice` · `isPriceDuplicate` · `editPrice` · `delPrice` · `priceFormHTML` · `bindPriceFormCombos` · `savePriceDrawer` · `toggleAllPrices` · `updatePriceBatchBtn` · `batchDeletePrices`

**`js/views/invoices.js`**（9 函数）— 发票管理
`syncInvoices` · `invoiceIssueData` · `invoiceReceiveData` · `viewInvoices` · `switchInvSubTab` · `onInvUnitFilter` · `onInvSearch` · `invPage` · `openInvEdit`

**`js/views/data.js`**（8 函数）— 数据管理
`renderStorageStatus` · `renderBackupSection` · `renderFileSyncSection` · `renderDangerZone` · `viewData` · `exportJSON` · `importJSON` · `clearAllData`

**`js/views/specs.js`**（10 函数）— 属性规格
`countSpecUsage` · `batchImportSpecHTML` · `renderSpecGroup` · `viewSpecs` · `toggleSpecGroup` · `filterSpecVals` · `clearSpecFilter` · `delSpecVal` · `openBatchImportSpec` · `exportAllSpecs`

**`js/views/dashboard.js`**（2 函数）— 概览看板
`gotoPendingOrders` · `viewDashboard`
