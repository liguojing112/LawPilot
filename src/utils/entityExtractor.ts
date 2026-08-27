/**
 * 实体提取工具 — 从法律文书文本中提取结构化信息
 * 纯正则实现，无需 AI/ML
 */

export interface ExtractedEntities {
  persons: string[]
  orgs: string[]
  dates: string[]
  amounts: string[]
  caseNumbers: string[]
}

/** 常见中文姓氏 */
const SURNAMES = '王李张刘陈杨赵黄周吴徐孙马胡朱郭何罗高林郑梁谢宋唐许邓冯韩曹彭曾萧田董潘袁于蒋蔡余杜叶程苏魏吕丁任卢姚沈钟姜崔谭陆范汪廖石金韦贾夏付方邹熊孟秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤温芦'

/** 法律相关机构后缀 */
const ORG_SUFFIX = '(?:法院|检察院|公安局|派出所|司法局|律师|事务所|公司|银行|信用社|局|厅|委员会|管理处|中心|协会|基金会)'

/**
 * 从文本中提取法律实体
 */
export function extractEntities(text: string): ExtractedEntities {
  if (!text) return { persons: [], orgs: [], dates: [], amounts: [], caseNumbers: [] }

  const result: ExtractedEntities = {
    persons: [],
    orgs: [],
    dates: [],
    amounts: [],
    caseNumbers: [],
  }

  // 1. 案号: (YYYY)法院代码 民/刑/行/执 初/终 第X号
  // 法院代码可能含数字，如: 京0105、粤03、最高法
  const caseNumberRegex = /[（(]\s*\d{4}\s*[）)]\s*[\u4e00-\u9fa5\d]{2,12}[民刑行执赔]\s*(?:初|终|再|重|监)?\s*(?:字)?\s*第?\s*\d+\s*号/g
  const cnMatches = text.match(caseNumberRegex)
  if (cnMatches) {
    result.caseNumbers = [...new Set(cnMatches.map((s) => s.replace(/\s+/g, '')))]
  }

  // 2. 金额: 支持千分位逗号，如 8,500,000 元
  // \d{1,3}(?:,\d{3})* 匹配千分位格式，|\d+ 匹配普通数字
  const amountRegex = /(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?\s*(?:亿|万|千|百)?\s*元/g
  const amMatches = text.match(amountRegex)
  if (amMatches) {
    result.amounts = [...new Set(amMatches.map((s) => s.replace(/\s+/g, '').replace(/,/g, '')))]
      .filter((a) => {
        const num = parseFloat(a.replace(/[亿元万千百]/g, (m) => m === '亿' ? 'e8' : m === '万' ? 'e4' : ''))
        return !isNaN(num) && num > 0
      })
      .slice(0, 20)
  }

  // 3. 日期: YYYY年M月D日
  const dateRegex = /\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/g
  const dtMatches = text.match(dateRegex)
  if (dtMatches) {
    result.dates = [...new Set(dtMatches.map((s) => s.replace(/\s+/g, '')))].slice(0, 20)
  }

  // 4. 机构: 名称 + 法律/商业后缀
  const orgRegex = new RegExp(`[\\u4e00-\\u9fa5]{2,12}${ORG_SUFFIX}`, 'g')
  const orgMatches = text.match(orgRegex)
  if (orgMatches) {
    result.orgs = [...new Set(orgMatches)].filter((o) => o.length >= 4).slice(0, 15)
  }

  // 5. 中文姓名: 常见姓氏 + 1-2个汉字，后面跟标点或空白（不跟常见法律用语，减少误判）
  const nameRegex = new RegExp(`[${SURNAMES}][\\u4e00-\\u9fa5]{1,2}(?=[：:，。；、\\s\\(（）\\)\"''「」『』\\n\\r])`, 'g')
  const nameMatches = text.match(nameRegex)
  if (nameMatches) {
    // 过滤无效词 — 包含常见非姓名组合
    const invalidNames = new Set([
      '关于', '根据', '依照', '按照', '对于', '由于', '因为', '所以', '但是',
      '可以', '应当', '必须', '不得', '已经', '并且', '或者', '如果', '虽然',
      '本院', '本案', '原告', '被告', '第三人', '申请人', '被申请', '上诉人',
      '被上诉', '原审', '再审', '法定', '委托', '指定', '诉讼', '代理',
      '审判长', '审判员', '书记员', '陪审员', '执行员', '公证员',
      '人民法院', '人民检察', '公安机关', '司法行政', '律师事务',
      '北京市', '上海市', '天津市', '重庆市', '河北省', '山西省',
      '住所地', '户籍地', '经常', '居住地', '通讯', '联系', '方式',
      // 常见误判：姓氏字符组成的非人名
      '付款', '付清', '付给', '付了', '交付', '支付', '应付', '预付', '给付',
      '向被', '向原', '向本', '向其', '向他', '向你', '向我', '向该',
      '对方', '对此', '对此', '对被', '对人',
      // 其他常见非名
      '事宜', '事项', '本案', '案情', '案件', '事实', '证据',
      '请求', '申请', '被告', '原告',
    ])
    result.persons = [...new Set(nameMatches)]
      .filter((n) => !invalidNames.has(n) && !invalidNames.has(n.slice(0, 2)))
      .filter((n) => !/[\d零一二三四五六七八九十百千万亿]/.test(n))
      // 排除纯动词/名词组合
      .filter((n) => n.length >= 2 && !/^(付款|付款|付清|交付|支付|给[付])/.test(n))
      .slice(0, 15)
  }

  return result
}

/**
 * 检查是否有任何实体被提取
 */
export function hasEntities(entities: ExtractedEntities): boolean {
  return (
    entities.persons.length > 0 ||
    entities.orgs.length > 0 ||
    entities.dates.length > 0 ||
    entities.amounts.length > 0 ||
    entities.caseNumbers.length > 0
  )
}
