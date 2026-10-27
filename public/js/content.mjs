// Business Quick Fix (v4) content: fixed text per pillar, intake options and the calculators.
// Taken word for word from original/v4/Business_Quick_Fix_Prototype.html (data + workshopData).
// Shared by the browser (app), the server (PDF report, Sheet rows) and the tests.

export const INTAKE = {
  "industry": [
    "F&B / Makanan & Minuman",
    "Fesyen / Pakaian / Aksesori",
    "Kecantikan / Kosmetik / Penjagaan diri",
    "Kesihatan / Wellness / Fitness",
    "Pendidikan / Training / Coaching",
    "Servis profesional / Konsultansi",
    "Perkhidmatan kreatif / Digital",
    "Retail / Kedai fizikal",
    "E-commerce / Online seller",
    "Wholesale / Pemborong / Pengedar",
    "Pembuatan / Manufacturing",
    "Pertanian / Agro / Makanan mentah",
    "Kontraktor / Pembinaan / Renovasi",
    "Automotif",
    "Logistik / Pengangkutan",
    "Hospitaliti / Pelancongan",
    "Hartanah",
    "Lain-lain"
  ],
  "businessModel": [
    "Jual produk fizikal",
    "Jual produk digital",
    "Jual servis",
    "Produk dan servis",
    "Retail / Jualan terus kepada pelanggan",
    "Online seller / E-commerce",
    "Pengedar / Pemborong",
    "Reseller / Agent / Dropship",
    "Pengilang / Manufacturer",
    "Langganan / Membership",
    "Lain-lain"
  ],
  "businessAge": [
    "Kurang daripada 1 tahun",
    "1 hingga kurang 3 tahun",
    "3 hingga kurang 5 tahun",
    "5 tahun ke atas"
  ],
  "monthlySales": [
    "Bawah RM5,000",
    "RM5,000–RM10,000",
    "Lebih RM10,000 hingga RM30,000",
    "RM30,000 ke atas",
    "Belum ada jualan konsisten",
    "Tidak pasti"
  ]
};

export const PILLARS = {
  "sales": {
    "name": "Sales (LIVE Sales)",
    "short": "Sales",
    "blurb": "Cabaran jualan LIVE & conversion",
    "label": "BAHAGIAN 01 · SALES (LIVE SALES)",
    "title": "Apa yang menghalang jualan anda daripada meningkat?",
    "intro": "Pilih tiga situasi yang paling kerap berlaku ketika anda menjual. Fokus pada cara anda menarik minat, meyakinkan pelanggan dan menukar minat kepada pembelian.",
    "issues": [
      "Saya buat LIVE tetapi viewers keluar selepas beberapa saat atau minit.",
      "Viewers tengok sahaja dan sangat sedikit yang komen atau berinteraksi.",
      "Saya tidak tahu bagaimana nak kekalkan momentum dan perhatian semasa LIVE.",
      "Saya menerangkan produk tetapi viewers masih tidak nampak sebab untuk membeli.",
      "Ramai bertanya harga tetapi tidak meneruskan pembelian.",
      "Saya tidak tahu bagaimana nak menjawab bantahan atau keraguan pelanggan.",
      "Tawaran dan sebab untuk membeli sekarang tidak cukup jelas.",
      "Saya tidak menyebut cara untuk order atau CTA dengan jelas.",
      "Saya sudah lama menjual atau buat LIVE tetapi jumlah order masih rendah.",
      "Saya tidak menyemak data jualan atau LIVE untuk mengetahui bahagian yang perlu dibaiki."
    ],
    "titleOut": "Kemungkinan terdapat jurang dalam proses menukar perhatian dan minat kepada pembelian.",
    "introOut": "Pilihan anda menunjukkan cabaran mungkin berlaku pada tarikan awal, penerangan nilai produk, cara menjawab keraguan atau proses closing. Ini diagnosis awal; punca sebenar perlu disahkan melalui contoh dan data jualan.",
    "cause": "Kemungkinan proses menjual belum cukup tersusun dari awal hingga akhir. Contohnya, pelanggan tertarik tetapi belum nampak nilai, belum yakin, atau tidak jelas bagaimana hendak membeli. Jika cabaran berlaku ketika LIVE, rakaman dan data LIVE boleh membantu mengenal pasti bahagian yang paling lemah.",
    "impact": "Prospek mungkin hilang sebelum membeli walaupun sudah menunjukkan minat. Masa dan usaha menjual tidak semestinya menghasilkan order, dan sukar untuk mengetahui tindakan mana yang benar-benar meningkatkan conversion.",
    "fix": "Pilih satu produk untuk sesi jualan atau LIVE seterusnya. Gunakan struktur ringkas: (1) sebut masalah pelanggan, (2) tunjukkan bagaimana produk membantu dan buktikan manfaatnya, (3) terangkan tawaran dan langkah order dengan jelas. Rekod jumlah pertanyaan dan order untuk dibandingkan dengan sesi sebelumnya.",
    "evidence": "Semak satu rakaman LIVE atau sekurang-kurangnya 10 rekod pertanyaan/jualan. Catat pertanyaan, bantahan, masa respons, CTA dan hasil akhir. Jangan anggap semua masalah berpunca daripada closing tanpa melihat bukti.",
    "reflection": "Di bahagian mana pelanggan paling kerap berhenti sebelum membeli? Apa yang anda boleh semak untuk mengesahkan sama ada masalah itu berpunca daripada perhatian, keyakinan, tawaran atau proses closing?",
    "impactPrompt": "Fikirkan berapa ramai penonton yang benar-benar relevan, berapa orang bertanya dan berapa order berlaku. Jangan anggap semua viewers ialah bakal pembeli.",
    "calculatorTitle": "Simulasikan peluang jualan daripada LIVE",
    "calculatorIntro": "Masukkan anggaran untuk satu sesi LIVE. Tukar angka supaya sepadan dengan bisnes anda.",
    "fields": [
      {
        "id": "viewers",
        "label": "Purata viewers yang relevan",
        "value": 100,
        "min": 0
      },
      {
        "id": "conversion",
        "label": "Kadar pembelian semasa (%)",
        "value": 2,
        "min": 0,
        "max": 100,
        "step": 0.5
      },
      {
        "id": "orderValue",
        "label": "Purata nilai setiap order (RM)",
        "value": 80,
        "min": 0,
        "step": 1
      },
      {
        "id": "targetRate",
        "label": "Kadar pembelian sasaran untuk diuji (%)",
        "value": 4,
        "min": 0,
        "max": 100,
        "step": 0.5
      }
    ],
    "exerciseTitle": "Bina pembukaan LIVE 30 saat",
    "exerciseBrief": "Matlamatnya bukan terus menulis skrip sempurna. Bina pembukaan yang memberi sebab kepada pelanggan sasaran untuk berhenti dan terus menonton.",
    "exercisePrompt": "Lengkapkan empat bahagian ini: (1) Siapa pelanggan yang anda bantu? (2) Apakah masalah spesifik mereka? (3) Apa yang akan mereka dapat jika terus menonton? (4) Apakah bukti atau contoh yang boleh anda tunjukkan?",
    "example": "Untuk pemilik kulit sensitif yang selalu tersalah pilih pencuci muka, dalam LIVE ini saya akan tunjuk tiga perkara pada label yang patut anda semak sebelum membeli. Saya juga akan bandingkan contoh produk supaya anda nampak apa yang perlu diperhatikan.",
    "takeaway": "Anda telah memetakan kemungkinan titik kebocoran jualan dan membina satu pembukaan LIVE untuk diuji.",
    "gap": "Menguji pembukaan sahaja belum menjamin conversion. Anda masih perlu menghubungkan penerangan nilai, tawaran, jawapan kepada bantahan dan CTA, kemudian membandingkan data setiap sesi.",
    "defaultAction": "Uji pembukaan baharu dalam satu LIVE dan catat viewers relevan, pertanyaan serta order.",
    "defaultMeasure": "Bandingkan pertanyaan dan order dengan satu LIVE sebelumnya yang hampir sama.",
    "defaultProof": "Rakaman LIVE, pertanyaan pelanggan, CTA yang digunakan dan jumlah order."
  },
  "marketing": {
    "name": "Marketing",
    "short": "Marketing",
    "blurb": "Cabaran content & marketing",
    "label": "BAHAGIAN 02 · MARKETING",
    "title": "Apa yang menghalang marketing anda daripada menarik pelanggan?",
    "intro": "Pilih tiga situasi yang paling menggambarkan cara anda merancang dan menghasilkan content untuk bisnes.",
    "issues": [
      "Saya selalu buntu dan tidak tahu content apa yang patut dipost.",
      "Saya post hanya apabila ada masa; tiada perancangan content yang konsisten.",
      "Content saya banyak bercerita tentang produk tetapi terasa berulang.",
      "Content saya tidak cukup menarik untuk membuat orang berhenti scroll.",
      "Saya tidak pasti masalah atau keperluan pelanggan yang patut dijadikan idea content.",
      "Saya sukar menulis hook atau opening yang menarik perhatian.",
      "Saya mengambil masa terlalu lama untuk menyiapkan satu content.",
      "Saya tidak tahu cara menyusun content supaya mesej mudah difahami.",
      "Content mendapat views atau likes tetapi kurang inquiry atau tindakan daripada bakal pelanggan.",
      "Saya tidak tahu cara menggunakan ChatGPT untuk menghasilkan content yang relevan dengan pelanggan dan brand saya."
    ],
    "titleOut": "Kemungkinan sistem perancangan dan penghasilan content anda belum cukup jelas atau konsisten.",
    "introOut": "Pilihan anda menunjukkan cabaran boleh berlaku ketika mencari idea, membina mesej, menghasilkan content atau menghubungkan content kepada tindakan pelanggan. Kita perlu menyemak contoh content sebenar untuk menentukan punca utama.",
    "cause": "Kemungkinan belum ada proses yang mudah diulang untuk mengenal pasti masalah pelanggan, membina idea, menulis hook, menyampaikan mesej dan meletakkan CTA. Menggunakan AI tanpa konteks pelanggan, produk dan brand juga boleh menghasilkan content yang generik.",
    "impact": "Masa mungkin banyak dihabiskan untuk memikirkan idea dan menyiapkan posting. Content menjadi tidak konsisten, mesej sukar dibina secara berterusan dan aktiviti marketing sukar dinilai berdasarkan hasil yang relevan.",
    "fix": "Pilih satu produk dan satu kumpulan pelanggan. Senaraikan tiga soalan atau masalah yang kerap mereka hadapi. Tukarkan satu masalah kepada content dengan empat elemen: hook yang spesifik, penerangan yang membantu, contoh atau bukti, dan satu CTA. Anda boleh gunakan ChatGPT untuk menghasilkan draf, kemudian semak ketepatan fakta dan kesesuaian dengan brand.",
    "evidence": "Semak lima content terkini. Untuk setiap satu, kenal pasti sasaran pelanggan, hook, masalah yang disentuh, CTA dan hasilnya. Bezakan metrik perhatian seperti views/likes daripada tindakan seperti inquiry, klik atau order.",
    "reflection": "Apa yang paling menghalang anda menghasilkan content yang konsisten: idea, masa, kemahiran menulis atau tiada proses? Apakah bukti yang menunjukkan cabaran itu paling besar?",
    "impactPrompt": "Nilai masa yang digunakan untuk mencari idea dan menyiapkan content, kemudian bandingkan dengan tindakan pelanggan yang benar-benar berlaku. Views sahaja tidak menunjukkan keseluruhan hasil marketing.",
    "calculatorTitle": "Kira masa yang boleh disusun semula",
    "calculatorIntro": "Anggarkan masa kerja content anda sekarang. Ini membantu menunjukkan beban proses, bukan menjanjikan pertambahan jualan.",
    "fields": [
      {
        "id": "contentCount",
        "label": "Bilangan content seminggu",
        "value": 3,
        "min": 0
      },
      {
        "id": "hoursEach",
        "label": "Jam untuk siapkan satu content",
        "value": 2,
        "min": 0,
        "step": 0.5
      },
      {
        "id": "plannedCount",
        "label": "Bilangan content sasaran seminggu",
        "value": 5,
        "min": 0
      },
      {
        "id": "plannedHours",
        "label": "Jam sasaran untuk satu content",
        "value": 1,
        "min": 0,
        "step": 0.5
      }
    ],
    "exerciseTitle": "Tukar satu masalah pelanggan menjadi content",
    "exerciseBrief": "Pilih satu produk dan satu kumpulan pelanggan. Bina satu content yang membantu, bukan sekadar menyenaraikan ciri produk.",
    "exercisePrompt": "Lengkapkan: (1) Siapa sasaran saya? (2) Masalah atau soalan apa yang mereka ada? (3) Hook yang spesifik. (4) Tiga isi yang membantu. (5) Bukti atau contoh. (6) Satu CTA yang jelas.",
    "example": "Sasaran: pemilik bisnes kecil yang selalu post tetapi kurang inquiry. Hook: “Content ada setiap hari, tapi pelanggan masih senyap?” Isi: semak sama ada content bercakap tentang masalah pelanggan, beri contoh penyelesaian, dan ajak mereka buat satu tindakan yang jelas. CTA: “Komen CONTENT jika anda mahu checklist semakan.”",
    "takeaway": "Anda telah menukar satu masalah pelanggan menjadi rangka content yang boleh disiapkan dan diuji.",
    "gap": "Satu content belum membentuk sistem. Anda masih perlu mengulang proses untuk beberapa masalah pelanggan, menjaga konsistensi brand dan menilai content berdasarkan inquiry atau tindakan.",
    "defaultAction": "Siapkan dan terbitkan tiga content daripada masalah pelanggan yang berbeza.",
    "defaultMeasure": "Rekod masa menyiapkan content, inquiry dan tindakan yang diterima.",
    "defaultProof": "Tiga content yang diterbitkan, CTA dan hasil setiap content."
  },
  "money": {
    "name": "Urus Duit",
    "short": "Urus Duit",
    "blurb": "Cabaran kos & keuntungan",
    "label": "BAHAGIAN 03 · URUS DUIT",
    "title": "Adakah anda tahu kos sebenar dan keuntungan produk anda?",
    "intro": "Pilih tiga situasi yang paling kerap berlaku ketika anda mengira kos, menetapkan harga dan menilai keuntungan.",
    "issues": [
      "Saya tidak pasti jumlah kos sebenar untuk satu unit produk.",
      "Saya menetapkan harga berdasarkan pesaing atau agak-agak sahaja.",
      "Saya tidak memasukkan semua kos berkaitan ketika mengira harga jualan.",
      "Saya tidak pasti berapa baki untung bagi setiap unit selepas kos produk ditolak.",
      "Saya memberi diskaun tetapi tidak tahu kesannya kepada margin.",
      "Saya tidak tahu produk mana yang memberikan margin lebih baik.",
      "Kos pembungkusan, caj platform atau caj transaksi sering terlepas daripada kiraan.",
      "Saya keliru antara jumlah sales, duit yang diterima dan keuntungan.",
      "Saya tidak tahu berapa unit perlu dijual untuk mencapai sasaran keuntungan.",
      "Saya masih mengira kos dan harga secara manual dan sukar menyemak andaian pengiraan."
    ],
    "titleOut": "Kemungkinan pengiraan kos penuh dan margin produk belum cukup jelas.",
    "introOut": "Pilihan anda menunjukkan ada kos atau kaedah pengiraan yang mungkin belum lengkap. Kita tidak boleh menyimpulkan produk rugi atau harga salah tanpa menyemak angka sebenar.",
    "cause": "Kemungkinan sebahagian kos langsung atau caj berkaitan jualan tidak dimasukkan, atau harga ditetapkan tanpa mengetahui margin yang diperlukan. Semakan perlu dibuat berdasarkan kos sebenar, kuantiti, harga jualan dan caj yang berkaitan dengan produk.",
    "impact": "Jika kos tidak lengkap, margin boleh kelihatan lebih tinggi daripada keadaan sebenar. Diskaun atau peningkatan jualan juga mungkin tidak menghasilkan keuntungan yang dijangka. Kesan sebenar bergantung pada struktur kos dan angka bisnes anda.",
    "fix": "Pilih satu produk yang paling kerap dijual. Senaraikan kos produk, pembungkusan, caj platform/transaksi, subsidi penghantaran jika ditanggung bisnes dan kos langsung lain yang berkaitan. Kira jumlah kos seunit, harga jualan dan baki kasar sebelum membuat keputusan harga. Elakkan mengira kos yang sama dua kali.",
    "evidence": "Sediakan invois pembekal, kos pembungkusan, caj platform/transaksi, kos penghantaran yang ditanggung dan harga jualan sebenar. Semak unit serta kuantiti. Bezakan margin kasar daripada keuntungan bersih kerana kos operasi lain mungkin belum dimasukkan.",
    "reflection": "Jika anda tahu kos seunit dan margin produk dengan lebih tepat, keputusan apa yang akan menjadi lebih jelas: harga, diskaun, pilihan produk atau sasaran jualan?",
    "impactPrompt": "Kos yang tertinggal boleh membuat margin nampak lebih tinggi daripada keadaan sebenar. Gunakan satu produk dan angka yang boleh disahkan; asingkan kos seunit daripada kos operasi bulanan.",
    "calculatorTitle": "Semak kos dan margin satu produk",
    "calculatorIntro": "Masukkan angka seunit. Kalkulator ini mengira anggaran baki selepas kos yang disenaraikan sahaja, bukan keuntungan bersih penuh.",
    "fields": [
      {
        "id": "sellingPrice",
        "label": "Harga jualan seunit (RM)",
        "value": 50,
        "min": 0,
        "step": 0.01
      },
      {
        "id": "productCost",
        "label": "Kos produk seunit (RM)",
        "value": 20,
        "min": 0,
        "step": 0.01
      },
      {
        "id": "packCost",
        "label": "Pembungkusan / kos langsung lain seunit (RM)",
        "value": 3,
        "min": 0,
        "step": 0.01
      },
      {
        "id": "fees",
        "label": "Caj platform / transaksi seunit (RM)",
        "value": 2,
        "min": 0,
        "step": 0.01
      }
    ],
    "exerciseTitle": "Bina senarai kos yang tidak boleh tertinggal",
    "exerciseBrief": "Pilih satu produk yang kerap dijual. Lengkapkan kosnya sebelum membuat keputusan harga atau diskaun.",
    "exercisePrompt": "Senaraikan kos produk, pembungkusan, caj platform/transaksi, subsidi penghantaran jika ditanggung bisnes, komisen jualan dan kos langsung lain. Catat sumber angka atau dokumen yang boleh mengesahkannya. Asingkan kos operasi bulanan untuk semakan keuntungan bersih.",
    "example": "Produk: set penjagaan diri. Kos produk RM20, pembungkusan RM2, caj transaksi RM1.50, subsidi penghantaran RM3. Jumlah kos yang disenaraikan RM26.50. Jika harga jualan RM50, baki sebelum kos operasi lain ialah RM23.50. Semak sama ada semua angka tepat dan tiada kos dikira dua kali.",
    "takeaway": "Anda telah mula menyemak harga berbanding kos yang disenaraikan dan mengenal pasti data yang masih perlu dicari.",
    "gap": "Baki selepas kos langsung bukan semestinya keuntungan bersih. Anda masih perlu menyemak kos operasi, volume jualan, diskaun, pulangan barang dan aliran tunai sebelum membuat keputusan besar.",
    "defaultAction": "Lengkapkan senarai kos sebenar untuk satu produk dan semak semua angka dengan dokumen.",
    "defaultMeasure": "Pastikan setiap kos utama mempunyai angka, unit dan sumber bukti.",
    "defaultProof": "Invois pembekal, caj platform, kos pembungkusan, penghantaran dan harga jualan sebenar."
  }
};

export const PILLAR_KEYS = ['sales', 'marketing', 'money'];
export const PICK = 3;

// Shown at the end of every report (07 · Reflection).
export const CLOSING = {
  title: 'Langkah seterusnya, ikut keperluan anda',
  text: 'Anda sudah ada satu tindakan untuk diuji. Selepas mengumpulkan bukti, semak sama ada masalah utama sudah berkurang atau masih memerlukan proses dan latihan yang lebih mendalam. Jika perlukan bantuan, pilih sesi lanjutan yang paling relevan dengan gap anda. Tiada keperluan untuk membuat keputusan sekarang.',
};
export const CALC_NOTE = 'Kalkulator ini untuk membantu anda berfikir dan membuat anggaran, bukan ramalan hasil. Semak andaian dan gunakan data sebenar sebelum membuat keputusan.';

export const money = (n) => 'RM' + n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n = (v) => Math.max(0, Number(v) || 0);

// The calculator inputs for a pillar: saved values where given, the prototype's defaults otherwise.
export function calcInputs(pillar, saved = {}) {
  return Object.fromEntries(PILLARS[pillar].fields.map((f) => [f.id, saved[f.id] ?? String(f.value)]));
}

// Same formulas and wording as the prototype. Returns the two headline lines, the small print,
// and the raw numbers (for tests and the Sheet).
export function calculate(pillar, saved = {}) {
  const v = Object.fromEntries(Object.entries(calcInputs(pillar, saved)).map(([k, x]) => [k, n(x)]));
  if (pillar === 'sales') {
    const now = (v.viewers * v.conversion) / 100 * v.orderValue;
    const scenario = (v.viewers * v.targetRate) / 100 * v.orderValue;
    return {
      lines: [`Anggaran jualan pada kadar semasa: ${money(now)}`, `Senario jika kadar pembelian menjadi ${v.targetRate}%: ${money(scenario)}`],
      note: `Perbezaan simulasi: ${money(scenario - now)} bagi satu LIVE. Ini bukan ramalan atau jaminan; pastikan viewers relevan dan andaian munasabah.`,
      numbers: { now, scenario, diff: scenario - now },
    };
  }
  if (pillar === 'marketing') {
    const current = v.contentCount * v.hoursEach, planned = v.plannedCount * v.plannedHours;
    return {
      lines: [`Masa content semasa: ${current.toLocaleString('en-MY')} jam seminggu`, `Senario perancangan baharu: ${planned.toLocaleString('en-MY')} jam seminggu`],
      note: `Perbezaan masa: ${(current - planned).toLocaleString('en-MY')} jam. Semak kualiti, kesesuaian dan hasil content juga; lebih banyak posting tidak semestinya lebih berkesan.`,
      numbers: { current, planned, diff: current - planned },
    };
  }
  const total = v.productCost + v.packCost + v.fees, balance = v.sellingPrice - total;
  const margin = v.sellingPrice ? (balance / v.sellingPrice) * 100 : 0;
  return {
    lines: [`Jumlah kos yang disenaraikan: ${money(total)} seunit`, `Baki selepas kos yang disenaraikan: ${money(balance)} seunit`],
    note: `Anggaran margin atas harga jualan: ${margin.toFixed(1)}%. Belum tentu keuntungan bersih; kos operasi lain mungkin belum dimasukkan.`,
    numbers: { total, balance, margin },
  };
}

// The plan fields start from the pillar's defaults (the start date is the participant's to pick).
export const defaultPlan = (pillar) => ({ action: PILLARS[pillar].defaultAction, measure: PILLARS[pillar].defaultMeasure, startDate: '', proof: PILLARS[pillar].defaultProof });

// Under an AI-written report.
export const AI_NOTE = 'Nota: Diagnosis, latihan dan pelan ini disediakan oleh AI berdasarkan maklumat yang anda pilih. Ia diagnosis awal: punca ialah hipotesis yang perlu disahkan dengan data dan bukti sebenar, dan bukan jaminan hasil. Angka kalkulator dikira oleh sistem berdasarkan input anda.';
// Under the report (adapted from the prototype's note, without "prototype").
export const REPORT_NOTE = 'Nota: Laporan ini berasaskan checklist dan respons berpandukan kategori, bukan AI. Punca ialah hipotesis awal yang perlu disahkan melalui data dan konteks anda. Hasil kalkulator bergantung pada input anda.';

// The current pillar's answers (each pillar keeps its own, so switching back loses nothing).
export function pillarAnswers(state = {}) {
  const pillar = PILLARS[state.pillar] ? state.pillar : null;
  const a = (pillar && state.byPillar?.[pillar]) || {};
  return {
    pillar,
    selected: Array.isArray(a.selected) ? a.selected.filter((i) => Number.isInteger(i) && i >= 0 && i < 10).slice(0, 3) : [],
    calc: a.calc || {}, workOutput: a.workOutput || '', plan: a.plan || {},
    ai: a.ai?.result ? a.ai : null, // { source: 'ai' | 'fixed', result, at, model, inputKey }
    planDone: Array.isArray(a.planDone) ? a.planDone.map(Boolean) : [],
  };
}

// The category names the AI coach prompt uses.
export const CATEGORY = { sales: 'Sales', marketing: 'Marketing', money: 'Cash Flow / Profit' };

// What the model sees: the business profile (no name or business name), the challenge, the three
// situations, and the calculator and start date only if the participant gave them.
export function coachInput(state = {}) {
  const p = state.profile || {};
  const { pillar, selected, calc, plan } = pillarAnswers(state);
  const P = PILLARS[pillar];
  const own = P.fields.filter((f) => String(calc[f.id] ?? '').trim() !== '');
  const values = calcInputs(pillar, calc);
  const r = calculate(pillar, calc);
  return {
    business_industry: p.industry || 'Tidak dinyatakan',
    business_model: p.businessModel || 'Tidak dinyatakan',
    business_operating_age: p.businessAge || 'Tidak dinyatakan',
    monthly_sales_range: p.monthlySales || 'Tidak dinyatakan',
    selected_business_category: CATEGORY[pillar],
    selected_issues: selected.map((i, n) => ({ number: n + 1, issue: P.issues[i] })),
    calculator: own.length
      ? {
          title: P.calculatorTitle,
          inputs: P.fields.map((f) => ({ label: f.label, value: values[f.id], entered_by_participant: own.includes(f) })),
          results_computed_by_app: [...r.lines, r.note],
        }
      : 'Peserta tidak memasukkan angka kalkulator.',
    action_start_date: plan.startDate || 'Belum dipilih',
  };
}
