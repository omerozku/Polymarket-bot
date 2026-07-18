# Oracle Cloud Bot Kurulum - Devam Notları

## Instance Bilgileri
- **Name:** instance-20260717-2344
- **IP:** 92.5.46.226
- **VCN:** polyanna
- **Subnet:** subnet-20260717-2242 (Public)
- **Shape:** VM.Standard.A2.Flex (ARM, 0.5 OCPU, 6GB RAM)
- **Image:** Ubuntu 24.04 Minimal aarch64
- **SSH Key:** `C:\Users\omero\Downloads\ssh-key-2026-07-17 (2).key`
- **Region:** eu-frankfurt-1

## Sorun
SSH ve ping ile instance'a bağlanılamıyor. Instance Running gözüküyor ama port 22'ye ulaşılamıyor.

## Yapılanlar
1. Internet Gateway oluşturuldu: `polyanna`
2. Route Table'a `0.0.0.0/0` → Internet Gateway eklendi
3. Security List'te port 22 TCP açık
4. Subnet Public olarak ayarlı
5. Instance stop/start yapıldı
6. Console connection oluşturuldu, Cloud Shell ile bağlanıldı ama şifre olmadığı için login olunamadı (ubuntu/opc denendi)

## Kalınan Nokta
Cloud Shell ile OCI CLI kullanarak instance'a `user_data` ekleyip firewall'u kapatmayı deniyoruz.

## Yarın Yapılacaklar

### Seçenek A: OCI CLI ile user_data ekle (Cloud Shell'den)
Cloud Shell'de şunları sırayla çalıştır:

```bash
# 1. Compartment ID al
export COMPARTMENT_ID=$(oci iam compartment list --query "data[0].\"compartment-id\"" --raw-output)

# 2. Instance ID al
oci compute instance list --compartment-id $COMPARTMENT_ID --query "data[?\"display-name\"=='instance-20260717-2344'].id" --raw-output

# 3. Instance ID ile user_data ekle (ID'yi yukarıdan al)
# user_data base64: #!/bin/bash\nufw disable 2>/dev/null\n
oci compute instance update --instance-id <INSTANCE_ID> --user-data 'IyEvYmluL2Jhc2gKdWZ3IGRpc2FibGUgMj4vZGV2L251bGwK' --force

# 4. Instance'ı reboot et
oci compute instance action --instance-id <INSTANCE_ID> --action SOFTRESET
```

### Seçenek B: Terminate ve Yeniden Oluştur
1. Instance'ı terminate et
2. Yeni instance oluştururken aynı ayarları kullan
3. Instance creation sırasında **Advanced Options → Management** altından **Custom data** alanını bulmaya çalış
4. Bulunursa cloud-init script ekle:
   ```bash
   #!/bin/bash
   ufw disable 2>/dev/null
   ```
5. Bulunmazsa instance oluşturulduktan sonra instance detail sayfasından **Custom metadata** bölümüne `user_data` ekle

### Seçenek C: Serial Console'dan Şifre Ayarla
Cloud Shell console connection'da `ubuntu` kullanıcısı için şifre ayarla:
```
sudo passwd ubuntu
```
(Çalışmayabilir çünkü sudo için de şifre gerekebilir)

## Bot Kurulumu (SSH bağlandıktan sonra)
```bash
# 1. Gerekli paketleri kur
sudo apt update && sudo apt upgrade -y
sudo apt install -y nodejs npm git

# 2. Node.js 20 kur (ARM için)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 3. PM2 kur
sudo npm install -g pm2

# 4. Repo'yu clone et
cd /home/ubuntu
git clone <REPO_URL> polyanna

# 5. .env dosyasını oluştur
cd polyanna
cp .env.example .env
nano .env  # değerleri doldur

# 6. Bağımlılıkları kur
npm install

# 7. Build et
npm run build

# 8. Dashboard kur
cd dashboard && npm install && npm run build && cd ..

# 9. PM2 ile başlat
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

## .env Değerleri
```
POLYMARKET_PRIVATE_KEY=0x97de0d08de514401cebb40006c2d5753b98d044dd42dc0a142a265b9b340b022
CAPITAL_USD=46
DRY_RUN=false
ARBITRAGE_ENABLED=false
DIPARB_ENABLED=false
SMARTMONEY_ENABLED=true
TREND_ANALYSIS_ENABLED=false
DAILY_MAX_LOSS_PCT=0.08
MONTHLY_MAX_LOSS_PCT=0.20
MAX_DRAWDOWN_PCT=0.30
TOTAL_MAX_LOSS_PCT=0.50
TELEGRAM_BOT_TOKEN=8325307097:AAFNaSRbjUY65Vh2F27WuZA_BgRSKvUbsF8
TELEGRAM_CHAT_ID=6220413461
RELAYER_API_KEY=019f6bd6-9ea5-72c4-9cc5-fb86b856edc7
RELAYER_API_KEY_ADDRESS=0xa70Eec76775E1533E7DFb5e060b22D2545dd8a0F
FUNDER_ADDRESS=0xA00eed21f51b2f01E7be6b06e871143BA4B87B09
SIGNATURE_TYPE=3
```
