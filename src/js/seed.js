// seed.js — 预置示例数据（由 store.js 的 seedData() 包装调用，直接操作全局 DB）
/* =========================================================
   预置示例数据
   ========================================================= */
/** 初始化预置示例数据（关联单位、价格记录、采购订单），写入全局 DB 并持久化 */
function _seedData(DEFAULT_SPECS, saveDB){
  DB={units:[],specs:JSON.parse(JSON.stringify(DEFAULT_SPECS)),prices:[],orders:[],seq:100};

  // 关联单位
  DB.units=[
    {id:'U1',name:'华东机械制造有限公司',roles:['采购商'],term:'月结30天',rating:'主力',contacts:[
      {name:'王经理',phone:'138-0001-001',side:'采购商'},{name:'陈工',phone:'138-0001-002',side:'采购商'}]},
    {id:'U2',name:'顺达紧固件厂',roles:['供应商'],term:'款到发货',rating:'主力',contacts:[
      {name:'李工',phone:'139-0002-001',side:'供应商'},{name:'刘姐',phone:'139-0002-002',side:'供应商'}]},
    {id:'U3',name:'华强五金批发',roles:['供应商'],term:'月结60天',rating:'备选',contacts:[
      {name:'张采购',phone:'137-0003-001',side:'供应商'}]},
    {id:'U4',name:'恒盛供应链管理',roles:['供应商'],term:'月结30天',rating:'主力',contacts:[
      {name:'赵总',phone:'136-0004-001',side:'供应商'},{name:'小周',phone:'136-0004-002',side:'供应商'}]},
    {id:'U5',name:'精工不锈钢制品',roles:['供应商','采购商'],term:'月结45天',rating:'主力',contacts:[
      {name:'周经理',phone:'135-0005-001',side:'供应商'},{name:'钱经理',phone:'135-0005-002',side:'采购商'}]},
    {id:'U6',name:'中天建设工程集团',roles:['采购商'],term:'月结90天',rating:'新客',contacts:[
      {name:'孙总',phone:'134-0006-001',side:'采购商'}]},
    {id:'U7',name:'远洋特材贸易',roles:['供应商'],term:'款到发货',rating:'备选',contacts:[
      {name:'吴经理',phone:'133-0007-001',side:'供应商'}]},
    {id:'U8',name:'海固标准件',roles:['供应商'],term:'预付30%+月结',rating:'主力',contacts:[
      {name:'郑工',phone:'132-0008-001',side:'供应商'}]},
  ];
  DB.seq=8;

  // 价格记录
  DB.prices=[
    {id:'PR1',unitId:'U2',contact:'李工',type:'螺栓',standard:'GB/T',diameter:'M8',hardness:'8.8',surface:'本色',material:'304',price:0.95,validFrom:'2026-06-01',remark:'起订量1000',createdAt:'2026-07-20'},
    {id:'PR2',unitId:'U3',contact:'张采购',type:'螺栓',standard:'DIN',diameter:'M8',hardness:'8.8',surface:'镀锌(白)',material:'304',price:0.98,validFrom:'2026-06-15',remark:'',createdAt:'2026-07-15'},
    {id:'PR3',unitId:'U4',contact:'赵总',type:'螺栓',standard:'DIN',diameter:'M10',hardness:'A2-70',surface:'本色',material:'304',price:2.10,validFrom:'2026-07-01',remark:'',createdAt:'2026-07-18'},
    {id:'PR4',unitId:'U5',contact:'周经理',type:'螺钉',standard:'ISO',diameter:'M6',hardness:'A4-80',surface:'本色',material:'316',price:2.60,validFrom:'2026-07-10',remark:'316材质',createdAt:'2026-07-20'},
    {id:'PR5',unitId:'U5',contact:'周经理',type:'螺栓',standard:'GB/T',diameter:'M8',hardness:'8.8',surface:'本色',material:'304',price:0.93,validFrom:'2026-07-01',remark:'',createdAt:'2026-07-22'},
    {id:'PR6',unitId:'U2',contact:'李工',type:'螺栓',standard:'GB/T',diameter:'M10',hardness:'8.8',surface:'镀锌(彩)',material:'304',price:2.30,validFrom:'2026-07-01',remark:'',createdAt:'2026-07-21'},
    {id:'PR7',unitId:'U7',contact:'吴经理',type:'螺栓',standard:'DIN',diameter:'M12',hardness:'A4-70',surface:'本色',material:'316',price:4.20,validFrom:'2026-06-20',remark:'',createdAt:'2026-07-19'},
    {id:'PR8',unitId:'U8',contact:'郑工',type:'螺母',standard:'GB/T',diameter:'M8',hardness:'8',surface:'本色',material:'304',price:0.28,validFrom:'2026-07-05',remark:'',createdAt:'2026-07-22'},
    {id:'PR9',unitId:'U4',contact:'赵总',type:'垫圈',standard:'ISO',diameter:'M10',hardness:'200HV',surface:'本色',material:'304',price:0.18,validFrom:'2026-07-01',remark:'',createdAt:'2026-07-23'},
  ];
  DB.seq=9;

  // 采购订单（含1条逾期，含多供应商分配示例）
  DB.orders=[
    {
      id:'PO260805-001',buyerId:'U1',buyerContact:'王经理',project:'A厂区设备改造',delivery:'2026-08-05',
      status:'待确认',remark:'客户还在确认属性，需跟进',createdAt:'2026-07-28',
      items:[
        {id:'I1',type:'螺栓',standard:'GB/T',diameter:'M8',hardness:'8.8',surface:'本色',material:'304',qty:5000,salePrice:1.20,usage:'设备装配',remark:'',options:[]},
        {id:'I2',type:'螺母',standard:'GB/T',diameter:'M8',hardness:'8',surface:'本色',material:'304',qty:5000,salePrice:0.50,usage:'配套螺栓',remark:'',options:[]},
      ]
    },
    {
      id:'PO260728-002',buyerId:'U6',buyerContact:'孙总',project:'B标段紧固件采购',delivery:'2026-08-12',
      status:'寻货中',remark:'客户已确认属性，开始寻货',createdAt:'2026-07-28',
      items:[
        {id:'I3',type:'螺钉',standard:'ISO',diameter:'M6',hardness:'A4-80',surface:'本色',material:'316',qty:1500,salePrice:3.00,usage:'沿海防腐项目',remark:'必须316材质',options:[
          {id:'Q1',supplierId:'U5',contact:'周经理',price:2.60,allocQty:1500,stockNote:'有效期:2026-07-10',source:'priceLibrary',status:'已选'},
        ]},
        {id:'I4',type:'螺栓',standard:'DIN',diameter:'M12',hardness:'A4-70',surface:'本色',material:'316',qty:800,salePrice:5.50,usage:'结构连接',remark:'',options:[
          {id:'Q2',supplierId:'U7',contact:'吴经理',price:4.20,allocQty:800,stockNote:'有效期:2026-06-20',source:'priceLibrary',status:'已选'},
        ]},
      ]
    },
    {
      id:'PO260720-003',buyerId:'U1',buyerContact:'陈工',project:'C产线扩建',delivery:'2026-08-20',
      status:'报价中',remark:'报价已发出，待客户确认',createdAt:'2026-07-20',
      items:[
        // 多供应商分配示例：需求5000，顺达供3000 + 华强供2000
        {id:'I5',type:'螺栓',standard:'GB/T',diameter:'M8',hardness:'8.8',surface:'本色',material:'304',qty:5000,salePrice:1.25,usage:'钢结构',remark:'',options:[
          {id:'Q3',supplierId:'U2',contact:'李工',price:0.95,allocQty:3000,stockNote:'有效期:2026-06-01',source:'priceLibrary',status:'已选'},
          {id:'Q4',supplierId:'U5',contact:'周经理',price:0.93,allocQty:2000,stockNote:'有效期:2026-07-01',source:'priceLibrary',status:'已选'},
        ]},
        {id:'I5b',type:'螺栓',standard:'GB/T',diameter:'M10',hardness:'8.8',surface:'镀锌(彩)',material:'304',qty:3000,salePrice:2.80,usage:'钢结构',remark:'',options:[
          {id:'Q5',supplierId:'U2',contact:'李工',price:2.30,allocQty:3000,stockNote:'有效期:2026-07-01',source:'priceLibrary',status:'已选'},
        ]},
      ]
    },
    {
      id:'PO260710-004',buyerId:'U5',buyerContact:'钱经理',project:'D项目配套',delivery:'2026-08-15',
      status:'签约完成',remark:'已签约，出货中',createdAt:'2026-07-10',
      items:[
        {id:'I6',type:'垫圈',standard:'ISO',diameter:'M10',hardness:'200HV',surface:'本色',material:'304',qty:10000,salePrice:0.25,usage:'配套',remark:'',options:[
          {id:'Q6',supplierId:'U4',contact:'赵总',price:0.18,allocQty:10000,stockNote:'有效期:2026-07-01',source:'priceLibrary',status:'已选'},
        ]},
      ]
    },
    {
      id:'PO260620-005',buyerId:'U6',buyerContact:'孙总',project:'E项目一期',delivery:'2026-07-30',
      status:'完成',remark:'已交付',createdAt:'2026-06-20',
      items:[
        // 多供应商部分寻源示例：需求8000，顺达供5000 + 精工供2000，剩余1000
        {id:'I7',type:'螺栓',standard:'GB/T',diameter:'M8',hardness:'8.8',surface:'本色',material:'304',qty:8000,salePrice:1.15,usage:'设备',remark:'',options:[
          {id:'Q7',supplierId:'U2',contact:'李工',price:0.95,allocQty:5000,stockNote:'',source:'priceLibrary',status:'已选'},
          {id:'Q8',supplierId:'U5',contact:'周经理',price:0.93,allocQty:2000,stockNote:'',source:'priceLibrary',status:'已选'},
        ]},
      ]
    },
  ];
  DB.seq=20;
  DB.orderSeq=6;  // 现有示例订单5条，下一个序号从6开始
  saveDB();
}

