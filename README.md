# 🚀 leffloard.xyz — Kişisel Portfolyo & Blog Projesi

Modern web teknolojileri ile geliştirilmiş, şık tasarıma ve dinamik bir backend yapısına sahip kişisel portfolyo ve blog web sitesi. Frontend tarafında **React (Vite)**, backend tarafında ise **FastAPI** ve **MongoDB** kullanılmıştır.

---

## 🛠️ Teknoloji Yığını (Tech Stack)

### Frontend
- **React 19** & **Vite** — Hızlı ve modern arayüz geliştirme
- **Tailwind CSS** — Esnek ve modern stil yönetimi
- **React Router DOM** — Sayfa yönlendirmeleri ve dinamik blog rotaları
- **shadcn/ui** & **Radix UI** — Premium, erişilebilir ve özelleştirilebilir arayüz bileşenleri
- **Axios** — Backend API istekleri için HTTP istemcisi
- **Lucide React** — Modern ve temiz ikon kütüphanesi
- **Sonner & Toast** — Kullanıcı dostu bildirimler (toast notifications)

### Backend & Veritabanı
- **FastAPI** — Yüksek performanslı ve asenkron Python API framework'ü
- **MongoDB** & **Motor** — Asenkron MongoDB sürücüsü ile veritabanı yönetimi
- **Pydantic v2** — Veri doğrulama ve şema yönetimi
- **Uvicorn** — ASGI web sunucusu

---

## 📂 Proje Yapısı

```text
leffloard.xyz/
├── frontend/                     # React (Vite) Arayüz Kodu
│   ├── src/
│   │   ├── components/           # Arayüz Bileşenleri (Hero, About, Blog vb.)
│   │   │   ├── ui/               # Alt seviye UI bileşenleri (Button, Input vb.)
│   │   │   └── ...
│   │   ├── data/                 # Statik veriler
│   │   ├── hooks/                # Custom React hook'ları
│   │   ├── lib/                  # Yardımcı kütüphaneler (utils.js vb.)
│   │   ├── App.jsx               # Ana uygulama bileşeni
│   │   └── main.jsx              # Giriş noktası
│   ├── tailwind.config.js        # Tailwind konfigürasyonu
│   └── package.json              # Bağımlılıklar ve script'ler
│
├── backend/                      # FastAPI Backend Kodu
│   ├── server.py                 # FastAPI sunucu kodu ve API yönlendiricileri
│   ├── requirements.txt          # Python bağımlılık listesi
│   └── .env.example              # Örnek çevre değişkenleri dosyası
│
├── tests/                        # Test klasörü
│   └── __init__.py
│
└── egefitnessalwaysinbussinies.bat # Hızlı başlatma scripti (Windows)
```

---

## ⚡ Hızlı Başlangıç (Quick Start)

Projeyi yerel makinenizde çalıştırmanın en kolay yolu, Windows kullanıcıları için hazırlanmış olan özel `.bat` scriptini kullanmaktır.

### Tek Tıkla Çalıştırma (Windows)
Proje kök dizininde bulunan **`egefitnessalwaysinbussinies.bat`** dosyasını çift tıklayarak çalıştırın:
- Bu script, backend sunucusunu otomatik olarak yeni bir komut satırı (`cmd`) penceresinde başlatır.
- Frontend geliştirme sunucusunu ise mevcut pencerede ayağa kaldırır.

---

## 🔧 Detaylı Kurulum Adımları (Manual Setup)

Eğer projeyi adım adım manuel olarak çalıştırmak isterseniz aşağıdaki yönergeleri takip edebilirsiniz:

### 1. Ön Gereksinimler
- Bilgisayarınızda **Node.js** (v18+) ve **Python** (v3.10+) kurulu olmalıdır.
- Çalışan bir **MongoDB** veritabanına erişiminiz olmalıdır (yerel veya MongoDB Atlas).

### 2. Backend Kurulumu
1. `backend` klasörüne geçin:
   ```bash
   cd backend
   ```
2. Sanal ortam oluşturun ve aktif edin:
   ```bash
   python -m venv venv
   # Windows için:
   venv\Scripts\activate
   # macOS/Linux için:
   source venv/bin/activate
   ```
3. Gerekli kütüphaneleri yükleyin:
   ```bash
   pip install -r requirements.txt
   ```
4. `.env` dosyasını oluşturun ve veritabanı bilgilerinizi girin:
   ```bash
   copy .env.example .env
   # veya macOS/Linux için:
   cp .env.example .env
   ```
   `.env` dosyasının içeriği:
   ```env
   MONGO_URL=mongodb://localhost:27017
   DB_NAME=leffloard
   CORS_ORIGINS=http://localhost:5173
   ```
5. Sunucuyu başlatın:
   ```bash
   python -m uvicorn server:app --reload
   ```
   Backend varsayılan olarak `http://127.0.0.1:8000` adresinde çalışacaktır.

### 3. Frontend Kurulumu
1. `frontend` klasörüne geçin:
   ```bash
   cd frontend
   ```
2. Bağımlılıkları yükleyin:
   ```bash
   npm install
   ```
3. Geliştirme sunucusunu başlatın:
   ```bash
   npm run dev
   ```
   Frontend varsayılan olarak `http://localhost:5173` adresinde çalışacaktır.

---

## 📡 API Uç Noktaları (Endpoints)

FastAPI backend uygulaması aşağıdaki endpoint'leri sunar:

| Metot | Uç Nokta | Açıklama |
| :--- | :--- | :--- |
| **GET** | `/api/` | Çalışma durumunu test etmek için hoş geldiniz mesajı döner. |
| **POST** | `/api/status` | Yeni bir durum kontrol kaydı oluşturur ve MongoDB'ye kaydeder. |
| **GET** | `/api/status` | MongoDB'deki tüm durum kontrol kayıtlarını listeler. |

---

## 🖥️ Arayüz Bileşenleri (Frontend Components)

Frontend uygulaması modüler bir bileşen yapısına sahiptir:
- **Hero**: Dinamik giriş ve karşılama alanı.
- **About**: Biyografi ve hakkımda bilgileri.
- **Skills**: Görsel yetenek kartları.
- **Experience & Education**: Zaman çizelgesi şeklinde tasarlanmış iş ve eğitim geçmişi.
- **Projects**: Projelerin listelendiği ve detaylandırıldığı alan.
- **Pricing**: Freelance hizmet paketleri ve fiyatlandırmaları.
- **Blog & BlogDetails**: Makalelerin listelendiği ve dinamik olarak okunduğu blog sistemi.
- **Contact**: Ziyaretçilerin doğrudan iletişim kurabileceği form alanı.

---

## 🚀 Canlıya Alma (Deployment)

1. **Frontend Derleme (Build):**
   ```bash
   cd frontend
   npm run build
   ```
   Oluşan `dist` klasörünü Vercel, Netlify veya GitHub Pages gibi statik dosya barındırma servislerinde yayınlayabilirsiniz.
2. **Backend:**
   FastAPI uygulamasını Render, Railway veya kendi VPS sunucunuz üzerinde Docker/Uvicorn kullanarak canlıya alabilirsiniz.

---

## 📄 Lisans

Özel kişisel projedir. Tüm hakları saklıdır.
