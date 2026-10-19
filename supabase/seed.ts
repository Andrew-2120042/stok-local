import 'dotenv/config'
import { Pool } from 'pg'
import { generateEmbedding } from '../apps/api/src/lib/embeddings'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

// ─── Types ────────────────────────────────────────────────────────────────────

interface SeedSeller {
  name: string
  email: string
  trust_score: number
  fulfillment_rate: number
  dispute_rate: number
  avg_delivery_days: number
}

interface SeedProduct {
  name: string
  brand: string
  category: string
  description: string
  specs: Record<string, string | number>
  images: string[]
  price: number
  stock: number
}

// ─── Sellers ─────────────────────────────────────────────────────────────────

const sellers: SeedSeller[] = [
  {
    name: 'GadgetHub India',
    email: 'seller@gadgethub.in',
    trust_score: 80,
    fulfillment_rate: 100.00,
    dispute_rate: 0.00,
    avg_delivery_days: 3.0,
  },
  {
    name: 'TechNest Store',
    email: 'seller@technest.in',
    trust_score: 80,
    fulfillment_rate: 100.00,
    dispute_rate: 0.00,
    avg_delivery_days: 3.0,
  },
]

// ─── Products ─────────────────────────────────────────────────────────────────

const products: SeedProduct[] = [
  // ── Wireless Earbuds (10) ────────────────────────────────────────────────
  {
    name: 'boAt Airdopes 141',
    brand: 'boAt',
    category: 'Wireless Earbuds',
    description: 'True wireless earbuds with 42 hours total playback, BEAST Mode for ultra-low latency gaming, and IPX4 water resistance. Lightweight half-in-ear design with touch controls.',
    specs: { driver_size: '8mm', battery_earbuds: '6h', battery_case: '36h', total_playback: '42h', latency_mode: '60ms BEAST Mode', water_resistance: 'IPX4', bluetooth: '5.1', weight: '4.5g per earbud', mic: 'MEMS', charging: 'Type-C' },
    images: ['https://www.boat-lifestyle.com/cdn/shop/products/Airdopes141_Black.jpg'],
    price: 999,
    stock: 150,
  },
  {
    name: 'boAt Airdopes 411 ANC',
    brand: 'boAt',
    category: 'Wireless Earbuds',
    description: 'Active Noise Cancellation earbuds with up to 30dB noise reduction. Hybrid ANC technology, 10mm drivers, 30 hours total playtime, and premium Instacharge support.',
    specs: { driver_size: '10mm', anc: '30dB hybrid ANC', battery_earbuds: '6h', battery_case: '24h', total_playback: '30h', bluetooth: '5.3', water_resistance: 'IPX5', charging: 'Type-C', fast_charge: '10min = 150min', weight: '5.3g per earbud' },
    images: ['https://www.boat-lifestyle.com/cdn/shop/products/Airdopes411ANC.jpg'],
    price: 2499,
    stock: 80,
  },
  {
    name: 'Noise Buds VS104',
    brand: 'Noise',
    category: 'Wireless Earbuds',
    description: 'Quad-mic setup with Environmental Noise Cancellation for crystal-clear calls. 12mm drivers deliver bass-heavy sound with 60 hours total playback and low-latency gaming mode.',
    specs: { driver_size: '12mm', mic: 'Quad-mic ENC', battery_earbuds: '8h', battery_case: '52h', total_playback: '60h', gaming_latency: '45ms', bluetooth: '5.3', water_resistance: 'IPX5', charging: 'Type-C', eq_modes: '3 EQ presets' },
    images: ['https://www.gonoise.com/cdn/shop/products/NoiseBudsVS104.jpg'],
    price: 1299,
    stock: 120,
  },
  {
    name: 'OnePlus Nord Buds 2',
    brand: 'OnePlus',
    category: 'Wireless Earbuds',
    description: 'Fast Pair supported earbuds with 12.4mm titanium drivers, adaptive noise cancellation, and 36 hours combined playback. IP55 rated for workouts with 3-mic call clarity.',
    specs: { driver_size: '12.4mm titanium', anc: 'Adaptive ANC 25dB', mic: '3-mic', battery_earbuds: '9h', battery_case: '27h', total_playback: '36h', bluetooth: '5.3', water_resistance: 'IP55', charging: 'Type-C', google_fast_pair: 'Yes' },
    images: ['https://image01.oneplus.net/ebp/202304/nord-buds-2.jpg'],
    price: 2799,
    stock: 60,
  },
  {
    name: 'Realme Buds T300',
    brand: 'Realme',
    category: 'Wireless Earbuds',
    description: 'Premium TWS earbuds with 30dB ANC, 10mm LCP composite driver, and 40 hours total playtime. Spatial audio support and multipoint connection to two devices simultaneously.',
    specs: { driver_size: '10mm LCP', anc: '30dB ANC', battery_earbuds: '10h', battery_case: '30h', total_playback: '40h', bluetooth: '5.3', multipoint: 'Yes (2 devices)', spatial_audio: 'Yes', water_resistance: 'IP55', charging: 'Type-C' },
    images: ['https://image.realme.com/cdn/shop/products/BudsT300.jpg'],
    price: 1999,
    stock: 90,
  },
  {
    name: 'Anker Soundcore Liberty 4 NC',
    brand: 'Anker',
    category: 'Wireless Earbuds',
    description: 'Up to 98.5% noise cancellation with HearID ANC. Custom soundscape, LDAC support for Hi-Res wireless audio, 50 hours combined playback, and multipoint connection.',
    specs: { driver_size: '11mm', anc: '98.5% noise reduction', ldac: 'Yes (Hi-Res)', battery_earbuds: '10h', battery_case: '40h', total_playback: '50h', bluetooth: '5.3', multipoint: 'Yes (2 devices)', water_resistance: 'IPX4', charging: 'Type-C + Wireless' },
    images: ['https://cdn.anker.com/images/soundcore-liberty4nc-black.jpg'],
    price: 5999,
    stock: 40,
  },
  {
    name: 'boAt Airdopes 181',
    brand: 'boAt',
    category: 'Wireless Earbuds',
    description: 'Neckband-free open-ear sport earbuds with 20 hours playback, sweat-proof build, and BEAST Mode gaming. Magnetic charging case with USB-C, ideal for outdoor activities.',
    specs: { driver_size: '10mm', battery_earbuds: '6h', battery_case: '14h', total_playback: '20h', gaming_latency: '60ms', water_resistance: 'IPX4', bluetooth: '5.3', controls: 'Touch + Voice Assistant', weight: '4g per earbud', charging: 'Type-C' },
    images: ['https://www.boat-lifestyle.com/cdn/shop/products/Airdopes181.jpg'],
    price: 799,
    stock: 200,
  },
  {
    name: 'Noise Buds Connect 2',
    brand: 'Noise',
    category: 'Wireless Earbuds',
    description: 'Budget TWS earbuds with 13mm drivers, 50 hours total playback, and Hyper Sync for instant pairing. IPX5 water resistance with touch controls and voice assistant support.',
    specs: { driver_size: '13mm', battery_earbuds: '6h', battery_case: '44h', total_playback: '50h', bluetooth: '5.3', water_resistance: 'IPX5', controls: 'Touch', voice_assistant: 'Yes', charging: 'Type-C', hyper_sync: 'Yes' },
    images: ['https://www.gonoise.com/cdn/shop/products/NoiseBudsConnect2.jpg'],
    price: 899,
    stock: 175,
  },
  {
    name: 'Belkin SOUNDFORM Rise',
    brand: 'Belkin',
    category: 'Wireless Earbuds',
    description: 'Premium earbuds with Active Noise Cancellation, Transparency mode, and 38 hours combined playback. Works seamlessly with Apple and Android with Siri and Google Assistant.',
    specs: { anc: 'ANC + Transparency mode', battery_earbuds: '8h', battery_case: '30h', total_playback: '38h', bluetooth: '5.2', water_resistance: 'IPX5', voice_assistant: 'Siri & Google Assistant', charging: 'Type-C', multipoint: 'Yes', eq_modes: 'Belkin app EQ' },
    images: ['https://www.belkin.com/cdn/shop/products/soundform-rise-auc004.jpg'],
    price: 4999,
    stock: 35,
  },
  {
    name: 'Realme Buds Air 5 Pro',
    brand: 'Realme',
    category: 'Wireless Earbuds',
    description: 'Flagship earbuds with 50dB ANC, 11mm LCP + PU composite driver, LDAC Hi-Res audio, and 38 hours total playback. Triple-mic ENC for noise-free calls in loud environments.',
    specs: { driver_size: '11mm LCP+PU', anc: '50dB ANC', ldac: 'Yes', mic: 'Triple-mic ENC', battery_earbuds: '9h', battery_case: '29h', total_playback: '38h', bluetooth: '5.3', water_resistance: 'IP55', charging: 'Type-C' },
    images: ['https://image.realme.com/cdn/shop/products/BudsAir5Pro.jpg'],
    price: 3999,
    stock: 55,
  },

  // ── Wired Earphones (8) ──────────────────────────────────────────────────
  {
    name: 'boAt BassHeads 100',
    brand: 'boAt',
    category: 'Wired Earphones',
    description: 'Entry-level wired earphones with 10mm dynamic drivers delivering deep bass. Tangle-free flat cable, in-line microphone, and universal 3.5mm jack for all devices.',
    specs: { driver_size: '10mm', connector: '3.5mm', cable_length: '1.2m', cable_type: 'Flat tangle-free', mic: 'In-line', frequency_response: '20Hz–20kHz', impedance: '16Ω', sensitivity: '105dB' },
    images: ['https://www.boat-lifestyle.com/cdn/shop/products/BassHeads100.jpg'],
    price: 349,
    stock: 300,
  },
  {
    name: 'boAt BassHeads 242',
    brand: 'boAt',
    category: 'Wired Earphones',
    description: 'Metal body earphones with 10mm drivers and ergonomic half-in-ear design. 1.5m tangle-free cable with in-line mic and multi-function button. Gold-plated 3.5mm connector.',
    specs: { driver_size: '10mm', connector: '3.5mm gold-plated', cable_length: '1.5m', body: 'Metal alloy', mic: 'In-line multi-function', frequency_response: '20Hz–20kHz', impedance: '16Ω', sensitivity: '108dB' },
    images: ['https://www.boat-lifestyle.com/cdn/shop/products/BassHeads242.jpg'],
    price: 499,
    stock: 250,
  },
  {
    name: 'Noise X1 Wired',
    brand: 'Noise',
    category: 'Wired Earphones',
    description: 'Premium wired IEM with 12mm drivers and memory foam ear tips for passive noise isolation. Braided cable with in-line remote and microphone. Compatible with Android and iOS.',
    specs: { driver_size: '12mm', connector: '3.5mm L-shaped', cable_length: '1.2m', cable_type: 'Braided', ear_tips: 'Memory foam', mic: 'In-line remote + mic', noise_isolation: 'Passive', impedance: '18Ω', sensitivity: '110dB' },
    images: ['https://www.gonoise.com/cdn/shop/products/NoiseX1Wired.jpg'],
    price: 699,
    stock: 180,
  },
  {
    name: 'OnePlus Bullets Z2',
    brand: 'OnePlus',
    category: 'Wired Earphones',
    description: 'Signature OnePlus audio with 9.2mm titanium-coated drivers. Three-button remote, in-line mic, and IP55 rating. 1.2m oxygen-free copper cable for minimal signal loss.',
    specs: { driver_size: '9.2mm titanium-coated', connector: '3.5mm', cable_length: '1.2m', cable_material: 'Oxygen-free copper', mic: '3-button remote', water_resistance: 'IP55', impedance: '32Ω', sensitivity: '112dB', frequency_response: '20Hz–20kHz' },
    images: ['https://image01.oneplus.net/ebp/202205/bullets-z2.jpg'],
    price: 999,
    stock: 140,
  },
  {
    name: 'Realme Buds 2',
    brand: 'Realme',
    category: 'Wired Earphones',
    description: 'Wired earphones with 11.2mm bass boost driver and magnetic earbuds for tangle-free storage. Knit braided cable, in-line microphone, and 3-button control with volume adjust.',
    specs: { driver_size: '11.2mm bass boost', connector: '3.5mm', cable_length: '1.14m', cable_type: 'Knit braided', magnetic: 'Yes', mic: 'In-line 3-button', frequency_response: '20Hz–20kHz', impedance: '16Ω', sensitivity: '98dB' },
    images: ['https://image.realme.com/cdn/shop/products/RealmeBuds2.jpg'],
    price: 599,
    stock: 220,
  },
  {
    name: 'Sennheiser CX 120BT (Wired)',
    brand: 'Sennheiser',
    category: 'Wired Earphones',
    description: 'German-engineered in-ear headphones with 7mm neodymium drivers delivering Sennheiser signature sound. In-line remote, microphone, and three pairs of ear adapters for perfect fit.',
    specs: { driver_size: '7mm neodymium', connector: '3.5mm', cable_length: '1.2m', mic: 'In-line remote', ear_adapters: '3 sizes (S/M/L)', frequency_response: '17Hz–20kHz', impedance: '16Ω', sensitivity: '115dB', weight: '14g' },
    images: ['https://assets.sennheiser.com/img/cx120bt-wired.jpg'],
    price: 1299,
    stock: 90,
  },
  {
    name: 'JBL C100SI',
    brand: 'JBL',
    category: 'Wired Earphones',
    description: 'JBL Pure Bass sound with 8mm drivers in a compact design. Flat tangle-free cable with one-button in-line remote and microphone. Three sizes of ear tips included.',
    specs: { driver_size: '8mm', connector: '3.5mm', cable_length: '1.0m', cable_type: 'Flat', mic: 'In-line 1-button', ear_tips: '3 sizes', frequency_response: '20Hz–20kHz', impedance: '16Ω', sensitivity: '97dB' },
    images: ['https://assets.jbl.com/cdn/shop/products/jbl-c100si-black.jpg'],
    price: 699,
    stock: 160,
  },
  {
    name: 'Anker Soundcore Life Q20 Wired',
    brand: 'Anker',
    category: 'Wired Earphones',
    description: 'Hi-Res certified wired earphones with 40mm drivers and BassUp technology. Foldable design with padded headband, in-line mic, and 3.5mm + 6.35mm dual adapters.',
    specs: { driver_size: '40mm', connector: '3.5mm + 6.35mm adapter', hi_res: 'Hi-Res Audio certified', bass_up: 'BassUp technology', mic: 'In-line', foldable: 'Yes', frequency_response: '16Hz–40kHz', impedance: '32Ω', sensitivity: '108dB', weight: '250g' },
    images: ['https://cdn.anker.com/images/soundcore-q20-wired.jpg'],
    price: 2499,
    stock: 70,
  },

  // ── Phone Chargers (8) ────────────────────────────────────────────────────
  {
    name: 'Anker 511 Nano Pro 20W',
    brand: 'Anker',
    category: 'Phone Chargers',
    description: 'Ultra-compact GaN charger with 20W USB-C Power Delivery. 49% smaller than Apple 20W adapter. Foldable pin design and ActiveShield temperature protection. Charges iPhone 15 to 50% in 30 minutes.',
    specs: { wattage: '20W', ports: '1x USB-C', technology: 'GaN, Power Delivery 3.0', compatibility: 'iPhone 15/14/13, Samsung, iPad', size: '25.2 x 25.2 x 30.8mm', input: '100-240V AC', foldable_pins: 'Yes', temp_protection: 'ActiveShield' },
    images: ['https://cdn.anker.com/images/anker-511-nano-pro-20w.jpg'],
    price: 1499,
    stock: 110,
  },
  {
    name: 'Belkin BoostCharge Pro 25W',
    brand: 'Belkin',
    category: 'Phone Chargers',
    description: '25W Super Fast Charging wall adapter for Samsung Galaxy devices. USB-C PD 3.0 compatible with all USB-C devices. Compact design with safety certifications from UL, CE, and RoHS.',
    specs: { wattage: '25W', ports: '1x USB-C', technology: 'Power Delivery 3.0, AFC, Samsung Super Fast Charging', compatibility: 'Samsung Galaxy S24/S23/S22, all USB-C', certifications: 'UL, CE, RoHS', input: '100-240V AC', cable_included: 'No', foldable_pins: 'Yes' },
    images: ['https://www.belkin.com/cdn/shop/products/boostcharge-25w-wca004.jpg'],
    price: 1799,
    stock: 85,
  },
  {
    name: 'boAt Insta Charge 80W Dual Port',
    brand: 'boAt',
    category: 'Phone Chargers',
    description: '80W dual-port GaN charger with one USB-C (65W) and one USB-A (18W) port. Charges a laptop and phone simultaneously. Compact form factor 60% smaller than traditional 65W brick chargers.',
    specs: { total_wattage: '80W', usb_c_wattage: '65W PD', usb_a_wattage: '18W QC 3.0', ports: '1x USB-C + 1x USB-A', technology: 'GaN, PD 3.0, QC 3.0', compatibility: 'MacBook, iPad, iPhones, Samsung, Laptops', input: '100-240V AC', size: 'Compact GaN form factor' },
    images: ['https://www.boat-lifestyle.com/cdn/shop/products/boat80WDualPort.jpg'],
    price: 2499,
    stock: 65,
  },
  {
    name: 'OnePlus SUPERVOOC 80W Charger',
    brand: 'OnePlus',
    category: 'Phone Chargers',
    description: 'Official OnePlus 80W SUPERVOOC wall charger with bidirectional USB-C. Charges OnePlus 12 to 100% in 32 minutes. Dual safety protection chips and 17 safety certifications for protection against overcharge.',
    specs: { wattage: '80W SUPERVOOC', ports: '1x USB-C', compatibility: 'OnePlus 12/11/10 Pro, Oppo Find X series', charge_time: '0-100% in 32min (OnePlus 12)', input: '100-240V AC', safety_certs: '17 certifications', protection: 'Overcharge, overtemp, overvoltage', cable_included: 'Yes (1m USB-C)' },
    images: ['https://image01.oneplus.net/ebp/202401/80w-supervooc-charger.jpg'],
    price: 1999,
    stock: 75,
  },
  {
    name: 'Realme 65W GaN Slim Charger',
    brand: 'Realme',
    category: 'Phone Chargers',
    description: 'Ultra-thin GaN charger with 65W SuperDart Charge. Only 7.5mm thick — world-class slim design. Dual USB-C output with smart power distribution, compatible with all PD-enabled devices.',
    specs: { wattage: '65W', ports: '2x USB-C', technology: 'GaN, SuperDart Charge, PD 3.0', thickness: '7.5mm', compatibility: 'Realme GT series, iPhones, Samsung, Laptops', input: '100-240V AC', smart_distribution: 'Yes', certifications: 'CE, BIS, RoHS' },
    images: ['https://image.realme.com/cdn/shop/products/Realme65WGaNSlim.jpg'],
    price: 1799,
    stock: 95,
  },
  {
    name: 'Noise 33W Turbo Charger',
    brand: 'Noise',
    category: 'Phone Chargers',
    description: 'Compact 33W fast charger with USB-C output supporting PD 3.0 and QC 4.0. Foldable pin design, BIS certified, and compatible with all modern smartphones. 40% smaller than standard chargers.',
    specs: { wattage: '33W', ports: '1x USB-C', technology: 'PD 3.0, QC 4.0', certifications: 'BIS, CE, RoHS', input: '100-240V AC', foldable_pins: 'Yes', compatibility: 'All USB-C smartphones, iPhones', size: 'Compact 40% smaller than standard' },
    images: ['https://www.gonoise.com/cdn/shop/products/Noise33WTurbo.jpg'],
    price: 999,
    stock: 130,
  },
  {
    name: 'Anker 747 GaN Prime 150W',
    brand: 'Anker',
    category: 'Phone Chargers',
    description: '4-port 150W GaN Prime charger for power users. Two USB-C (100W + 100W) and two USB-A (18W each) ports. AI-powered dynamic power distribution, temperature monitoring, and charges 4 devices simultaneously.',
    specs: { total_wattage: '150W', usb_c_ports: '2x (up to 100W each)', usb_a_ports: '2x (18W each)', technology: 'GaN Prime, AI Power Distribution, PD 3.1', compatibility: 'MacBook Pro, iPad, iPhones, Samsung, Laptops', input: '100-240V AC', display: 'LED power indicator', size: '84 x 68 x 30mm' },
    images: ['https://cdn.anker.com/images/anker-747-gan-prime-150w.jpg'],
    price: 7999,
    stock: 30,
  },
  {
    name: 'Belkin BoostCharge 3-Port 67W',
    brand: 'Belkin',
    category: 'Phone Chargers',
    description: '3-port 67W desktop charger with one USB-C (67W) and two USB-A (12W) ports. Charges a MacBook Air, iPhone, and AirPods simultaneously. Auto-detect technology identifies and delivers optimal charge.',
    specs: { total_wattage: '67W', usb_c_wattage: '67W PD', usb_a_wattage: '12W x 2', ports: '1x USB-C + 2x USB-A', technology: 'PD 3.0, Auto-Detect', compatibility: 'MacBook Air, iPhones, Samsung, AirPods', certifications: 'UL, CE, RoHS', input: '100-240V AC', cable_included: 'No' },
    images: ['https://www.belkin.com/cdn/shop/products/boostcharge-67w-3port-wcd003.jpg'],
    price: 3499,
    stock: 50,
  },

  // ── Charging Cables (8) ───────────────────────────────────────────────────
  {
    name: 'Anker PowerLine III USB-C to Lightning 1m',
    brand: 'Anker',
    category: 'Charging Cables',
    description: 'MFi-certified braided nylon USB-C to Lightning cable. Supports 20W fast charging for iPhone. 12,000 bend lifespan at 90-degree angles tested in Anker labs.',
    specs: { length: '1m', connector_1: 'USB-C', connector_2: 'Lightning (MFi certified)', max_wattage: '20W', material: 'Braided nylon', bend_lifespan: '12,000 bends at 90°', compatibility: 'iPhone 14/13/12/11, iPad', mfi_certified: 'Yes', charging_speed: '20W fast charge' },
    images: ['https://cdn.anker.com/images/powerline-iii-usbc-lightning-1m.jpg'],
    price: 999,
    stock: 200,
  },
  {
    name: 'boAt Rugged V3 Type-C Cable 1.5m',
    brand: 'boAt',
    category: 'Charging Cables',
    description: 'Military-grade braided Type-C cable with 60W fast charging. Kevlar fiber interior and double-braided nylon exterior. 10,000+ bend test certified with 1.5m reach for convenience.',
    specs: { length: '1.5m', connector_1: 'USB-A', connector_2: 'USB-C', max_wattage: '60W', material: 'Kevlar + double-braided nylon', bend_lifespan: '10,000+ bends', compatibility: 'All USB-C devices, Android, OnePlus, Samsung', charging: '60W fast charge', data_transfer: 'Up to 480Mbps' },
    images: ['https://www.boat-lifestyle.com/cdn/shop/products/boatRuggedV3.jpg'],
    price: 399,
    stock: 350,
  },
  {
    name: 'Belkin BoostCharge USB-C to USB-C 100W 2m',
    brand: 'Belkin',
    category: 'Charging Cables',
    description: 'USB-C to USB-C cable rated for 100W / 5A charging — powerful enough for most laptops. 2m length, PVC jacket, Emark chip for safe 100W power delivery, data transfer at USB 2.0 speeds.',
    specs: { length: '2m', connector_1: 'USB-C', connector_2: 'USB-C', max_wattage: '100W', max_current: '5A', emark_chip: 'Yes', material: 'PVC jacket', compatibility: 'MacBook, iPad, Samsung Galaxy, Laptops', data_transfer: 'USB 2.0 (480Mbps)', certifications: 'CE, RoHS' },
    images: ['https://www.belkin.com/cdn/shop/products/boostcharge-usbc-100w-2m-cac003.jpg'],
    price: 1299,
    stock: 120,
  },
  {
    name: 'OnePlus Warp Charge 65W Type-C Cable 1m',
    brand: 'OnePlus',
    category: 'Charging Cables',
    description: 'Official OnePlus Type-C cable supporting Warp Charge 65 and SUPERVOOC protocols. Dual shielding with oxygen-free copper core for minimal resistance. Compatible with all USB-C devices.',
    specs: { length: '1m', connector_1: 'USB-A', connector_2: 'USB-C', max_wattage: '65W Warp Charge', core: 'Oxygen-free copper', shielding: 'Dual shielding', compatibility: 'OnePlus Warp Charge, SUPERVOOC, all USB-C', data_transfer: 'Up to 480Mbps', certifications: 'CE, BIS' },
    images: ['https://image01.oneplus.net/ebp/202201/warpcharge65-cable.jpg'],
    price: 499,
    stock: 180,
  },
  {
    name: 'Realme Dart Charge 65W Cable 1m',
    brand: 'Realme',
    category: 'Charging Cables',
    description: 'Official Realme 65W DartCharge cable with nylon braid and aluminum alloy connectors. Heat-resistant construction with 5000+ bend durability. Supports DartCharge and standard PD protocols.',
    specs: { length: '1m', connector_1: 'USB-A', connector_2: 'USB-C', max_wattage: '65W DartCharge', material: 'Nylon braid + aluminum alloy', bend_lifespan: '5,000+ bends', heat_resistance: 'Yes', compatibility: 'Realme DartCharge, PD, all USB-C', certifications: 'BIS, CE, RoHS' },
    images: ['https://image.realme.com/cdn/shop/products/RealmeDartChargeCable.jpg'],
    price: 349,
    stock: 220,
  },
  {
    name: 'Noise Tough Braid USB-C 2m',
    brand: 'Noise',
    category: 'Charging Cables',
    description: '2-meter nylon braided USB-C cable with 60W fast charging. Reinforced stress relief at both ends, aluminum alloy connector tips. Perfect for bedside or desk use where extra length matters.',
    specs: { length: '2m', connector_1: 'USB-A', connector_2: 'USB-C', max_wattage: '60W', material: 'Nylon braid + aluminum alloy', stress_relief: 'Double reinforced', bend_lifespan: '8,000+ bends', compatibility: 'All USB-C devices', data_transfer: 'Up to 480Mbps' },
    images: ['https://www.gonoise.com/cdn/shop/products/NoiseToughBraid2m.jpg'],
    price: 449,
    stock: 190,
  },
  {
    name: 'Anker PowerLine+ III USB-C to USB-C 240W',
    brand: 'Anker',
    category: 'Charging Cables',
    description: 'Premium 240W USB-C to USB-C cable using USB PD 3.1 EPR standard. Supports Gen 2 USB 3.2 data at 10Gbps. Double braided nylon exterior, laser-welded connectors, 35,000+ bend lifespan.',
    specs: { length: '1m', connector_1: 'USB-C', connector_2: 'USB-C', max_wattage: '240W EPR', max_current: '5A at 48V', usb_version: 'USB 3.2 Gen 2', data_transfer: '10Gbps', material: 'Double-braided nylon', bend_lifespan: '35,000+ bends', compatibility: 'USB PD 3.1 laptops, MacBook Pro 16"' },
    images: ['https://cdn.anker.com/images/powerline-plus-iii-240w.jpg'],
    price: 2499,
    stock: 75,
  },
  {
    name: 'boAt AlumiCable Type-C to Type-C 1m',
    brand: 'boAt',
    category: 'Charging Cables',
    description: 'Aluminum alloy shell USB-C to USB-C cable with 60W Power Delivery. Anti-tangle design with soft-touch cable sheath. Supports both fast charging and USB 2.0 data transfer.',
    specs: { length: '1m', connector_1: 'USB-C', connector_2: 'USB-C', max_wattage: '60W PD', material: 'Aluminum alloy shell, soft-touch sheath', anti_tangle: 'Yes', compatibility: 'All USB-C PD devices, MacBook, iPad, Samsung', data_transfer: 'USB 2.0 (480Mbps)', certifications: 'BIS, CE' },
    images: ['https://www.boat-lifestyle.com/cdn/shop/products/boatAlumiCable.jpg'],
    price: 549,
    stock: 160,
  },

  // ── Phone Cases (8) ───────────────────────────────────────────────────────
  {
    name: 'Spigen Tough Armor iPhone 15 Pro Max Case',
    brand: 'Spigen',
    category: 'Phone Cases',
    description: 'Military-grade drop protection with dual-layer structure. Air Cushion technology in all four corners. Kickstand for hands-free viewing. Compatible with MagSafe wireless charging.',
    specs: { compatible: 'iPhone 15 Pro Max', material: 'TPU + PC dual layer', protection: 'Military grade MIL-STD-810G', drop_height: 'Tested to 6.6ft', magsafe: 'MagSafe compatible', kickstand: 'Yes', raised_bezels: '0.8mm for screen, 1.5mm for camera', color_options: 'Gunmetal / Black', weight: '62g' },
    images: ['https://cdn.spigen.com/products/tough-armor-iphone15promax-gunmetal.jpg'],
    price: 1999,
    stock: 100,
  },
  {
    name: 'OtterBox Commuter Series iPhone 15 Case',
    brand: 'OtterBox',
    category: 'Phone Cases',
    description: 'Two-layer protection with synthetic rubber slipcover and hard polycarbonate shell. Port covers keep out dust and debris. Drop+ protection against 3x more drops than military standard.',
    specs: { compatible: 'iPhone 15', material: 'Synthetic rubber + polycarbonate', protection: 'Drop+ certified (3x MIL-STD-810G)', port_covers: 'Yes', magsafe: 'No', raised_bezels: '1mm screen, 1.2mm camera', slim_profile: 'Yes', color_options: 'Black / Navy Blue / Red', certifications: 'OSHA PPE tested' },
    images: ['https://www.otterbox.com/cdn/shop/products/commuter-iphone15-black.jpg'],
    price: 3499,
    stock: 60,
  },
  {
    name: 'Ringke Fusion Samsung Galaxy S24 Ultra Case',
    brand: 'Ringke',
    category: 'Phone Cases',
    description: 'Crystal clear PC back with soft TPU bumper frame. Precise cutouts for S Pen and all ports. Anti-yellowing coating maintains clarity over time. Raised lip protects camera and display.',
    specs: { compatible: 'Samsung Galaxy S24 Ultra', material: 'PC back + TPU bumper', s_pen_slot: 'Yes', anti_yellowing: 'Yes', transparency: 'Crystal clear', raised_bezels: '1mm screen, 1.5mm camera', weight: '25g', wireless_charging: 'Compatible', magsafe: 'No' },
    images: ['https://ringke.com/cdn/shop/products/fusion-s24ultra-clear.jpg'],
    price: 999,
    stock: 130,
  },
  {
    name: 'Spigen Ultra Hybrid Samsung Galaxy S24+ Case',
    brand: 'Spigen',
    category: 'Phone Cases',
    description: 'Transparent hybrid case combining clear PC back with flexible TPU sides. Air Cushion tech protects corners. Non-slip matte back with carbon fiber texture. Slim profile adds minimal bulk.',
    specs: { compatible: 'Samsung Galaxy S24+', material: 'PC + TPU hybrid', transparency: 'Crystal clear back', texture: 'Matte carbon fiber', air_cushion: 'Corner Air Cushion', wireless_charging: 'Compatible', magsafe: 'No', raised_bezels: '0.8mm screen, 1.2mm camera', weight: '30g' },
    images: ['https://cdn.spigen.com/products/ultra-hybrid-s24plus-clear.jpg'],
    price: 1299,
    stock: 110,
  },
  {
    name: 'Nomad Rugged Case iPhone 15',
    brand: 'Nomad',
    category: 'Phone Cases',
    description: 'Premium leather-look polycarbonate case with soft-touch matte finish. Slim profile, wireless charging compatible, and includes raised bezels for display and camera protection.',
    specs: { compatible: 'iPhone 15', material: 'Polycarbonate, soft-touch matte', magsafe: 'MagSafe compatible', wireless_charging: 'Yes', raised_bezels: '1mm screen + camera', slim: 'Yes, 1.3mm thin sides', color_options: 'Black / Blue / Tan', weight: '20g', drop_protection: 'Tested' },
    images: ['https://nomadgoods.com/cdn/shop/products/rugged-case-iphone15-black.jpg'],
    price: 2499,
    stock: 45,
  },
  {
    name: 'boAt Signature Ultra Slim iPhone 14 Case',
    brand: 'boAt',
    category: 'Phone Cases',
    description: 'Ultra-slim 0.8mm transparent PC case for iPhone 14. Anti-fingerprint coating, scratch-resistant back, and precise cutouts. Lightweight at 12g with wireless charging passthrough.',
    specs: { compatible: 'iPhone 14', material: 'PC (polycarbonate)', thickness: '0.8mm', weight: '12g', transparency: 'Crystal clear', anti_fingerprint: 'Yes', wireless_charging: 'Compatible', magsafe: 'No', raised_bezels: '0.3mm camera', coating: 'Scratch-resistant' },
    images: ['https://www.boat-lifestyle.com/cdn/shop/products/boatSlimCase14.jpg'],
    price: 499,
    stock: 200,
  },
  {
    name: 'OtterBox Symmetry Series Samsung Galaxy S24 Case',
    brand: 'OtterBox',
    category: 'Phone Cases',
    description: 'Slim dual-layer case with enhanced drop protection. One-piece design that slips on easily. Raised camera ring for lens protection. Compatible with wireless charging.',
    specs: { compatible: 'Samsung Galaxy S24', material: 'Polycarbonate + TPE dual layer', protection: 'Drop+ certified', wireless_charging: 'Compatible', raised_camera_ring: 'Yes', one_piece: 'Yes', color_options: 'Black / Pink / Clear', weight: '38g', thickness: '2.5mm sides' },
    images: ['https://www.otterbox.com/cdn/shop/products/symmetry-s24-black.jpg'],
    price: 2999,
    stock: 70,
  },
  {
    name: 'Ringke Onyx Samsung Galaxy A55 Case',
    brand: 'Ringke',
    category: 'Phone Cases',
    description: 'Flexible TPU case with dynamic woven texture for improved grip. Shock-absorbing air pocket corners, raised lips for screen and camera, and anti-dust port covers. Anti-yellowing formula.',
    specs: { compatible: 'Samsung Galaxy A55', material: 'Flexible TPU', texture: 'Dynamic woven', shock_absorption: 'Air pocket corners', port_covers: 'Anti-dust covers', anti_yellowing: 'Yes', wireless_charging: 'Compatible', weight: '22g', color_options: 'Black / Navy / Gray' },
    images: ['https://ringke.com/cdn/shop/products/onyx-galaxy-a55-black.jpg'],
    price: 799,
    stock: 150,
  },

  // ── Power Banks (8) ───────────────────────────────────────────────────────
  {
    name: 'Anker PowerCore 10000',
    brand: 'Anker',
    category: 'Power Banks',
    description: 'Ultra-compact 10,000mAh power bank smaller than most smartphones. PowerIQ and VoltageBoost deliver the fastest possible charge to any device. Can fit in a jeans pocket.',
    specs: { capacity: '10,000mAh', ports: '1x USB-A', input: 'Micro USB', output: '5V/2.4A (12W)', technology: 'PowerIQ + VoltageBoost', recharge_time: '6.5h', weight: '180g', size: '92 x 60 x 22mm', iphone_charges: 'Up to 2.5 charges for iPhone 15', certifications: 'CE, RoHS, FCC' },
    images: ['https://cdn.anker.com/images/powercore-10000-black.jpg'],
    price: 1799,
    stock: 120,
  },
  {
    name: 'boAt Energy Ring 10000 PD',
    brand: 'boAt',
    category: 'Power Banks',
    description: 'Wrist-worn 10,000mAh power bank with ring form factor. 18W Power Delivery output, 10W wireless charging, and LED indicator. Magnetic attachment for convenient carry.',
    specs: { capacity: '10,000mAh', form_factor: 'Ring/wrist', wireless_charging: '10W Qi', wired_output: '18W PD (USB-C)', input: 'Type-C 18W', led_indicator: '4-dot LED', weight: '195g', compatibility: 'All Qi devices, iPhones, Samsung', recharge_time: '5h' },
    images: ['https://www.boat-lifestyle.com/cdn/shop/products/boatEnergyRing10000.jpg'],
    price: 2499,
    stock: 60,
  },
  {
    name: 'Anker PowerCore III 20000 45W PD',
    brand: 'Anker',
    category: 'Power Banks',
    description: '20,000mAh high-capacity power bank with 45W USB-C PD. Charges a MacBook Air and two phones simultaneously. Multi-protect safety system with 12 layers of protection.',
    specs: { capacity: '20,000mAh', usb_c_output: '45W PD', usb_a_output: '18W QC 3.0 x 2', ports: '1x USB-C + 2x USB-A', input: '30W USB-C', technology: 'PowerIQ 3.0, QC 3.0, PD 3.0', recharge_time: '5.5h (with 30W adapter)', weight: '440g', size: '163 x 62 x 22mm', macbook_charges: '~0.9 charges MacBook Air M2' },
    images: ['https://cdn.anker.com/images/powercore-iii-20000-45w.jpg'],
    price: 4999,
    stock: 45,
  },
  {
    name: 'Realme 10000mAh Power Bank 2',
    brand: 'Realme',
    category: 'Power Banks',
    description: 'Slim 10,000mAh power bank with 18W two-way fast charge. Dual USB-A output ports and USB-C input/output. LED indicator and low-current mode for charging earphones and wearables.',
    specs: { capacity: '10,000mAh', ports: '2x USB-A + 1x USB-C', output: '18W fast charge', input: '18W USB-C', low_current_mode: 'Yes (for earphones)', led_indicator: '4-dot LED', recharge_time: '4h', weight: '218g', size: '148 x 72 x 15mm', iphone_charges: 'Up to 2 charges for iPhone 15' },
    images: ['https://image.realme.com/cdn/shop/products/Realme10000PB2.jpg'],
    price: 1299,
    stock: 140,
  },
  {
    name: 'OnePlus 10000mAh SUPERVOOC Power Bank',
    brand: 'OnePlus',
    category: 'Power Banks',
    description: 'Official OnePlus power bank with 50W SUPERVOOC charging for compatible OnePlus phones. USB-C in/out with 33W and a USB-A 18W output. Compact square form factor with LED dot display.',
    specs: { capacity: '10,000mAh', usb_c_output: '50W SUPERVOOC / 33W PD', usb_a_output: '18W QC 3.0', input: '33W USB-C', ports: '1x USB-C + 1x USB-A', led_display: 'Dot indicator', weight: '225g', size: '100 x 62 x 25mm', recharge_time: '2h (with 33W adapter)', oneplus_turbo: 'Yes (OnePlus 12/11/10)' },
    images: ['https://image01.oneplus.net/ebp/202402/10000-supervooc-powerbank.jpg'],
    price: 3499,
    stock: 55,
  },
  {
    name: 'Belkin BoostCharge 20000mAh Wireless',
    brand: 'Belkin',
    category: 'Power Banks',
    description: '20,000mAh power bank with 10W wireless charging pad on top, 15W USB-C PD port, and two USB-A 12W ports. Charges three devices simultaneously, including wirelessly. LED display shows remaining percentage.',
    specs: { capacity: '20,000mAh', wireless_charging: '10W Qi', usb_c_output: '15W PD', usb_a_output: '12W x 2', simultaneous_charging: '3 devices', display: 'LED percentage display', input: '18W USB-C', weight: '475g', size: '165 x 78 x 22mm', certifications: 'CE, RoHS, Qi' },
    images: ['https://www.belkin.com/cdn/shop/products/boostcharge-20000-wireless-bpb006.jpg'],
    price: 5999,
    stock: 35,
  },
  {
    name: 'Noise Power Pro 20000mAh 65W',
    brand: 'Noise',
    category: 'Power Banks',
    description: 'High-power 20,000mAh power bank with 65W USB-C PD — enough to fast charge a laptop. Dual USB-A outputs with 18W QC. Transparent back design with internal battery visible. Smart LED display.',
    specs: { capacity: '20,000mAh', usb_c_output: '65W PD', usb_a_output: '18W QC 3.0 x 2', input: '65W USB-C', ports: '1x USB-C + 2x USB-A', display: 'LED percentage', design: 'Transparent back', recharge_time: '3.5h (with 65W adapter)', weight: '455g', laptop_compatible: 'Yes (MacBook, Dell, Lenovo)' },
    images: ['https://www.gonoise.com/cdn/shop/products/NoisePowerPro20000.jpg'],
    price: 3999,
    stock: 50,
  },
  {
    name: 'boAt Energyshroom 5000 Micro',
    brand: 'boAt',
    category: 'Power Banks',
    description: 'Ultra-compact lipstick-style 5000mAh power bank with built-in USB-A output and Micro USB cable. Perfect for travel and emergencies. Weighs only 105g, fits in any pocket.',
    specs: { capacity: '5,000mAh', built_in_cable: 'Micro USB input', output: 'USB-A 5V/1A', form_factor: 'Lipstick / stick', weight: '105g', size: '97 x 27 x 27mm', led_indicator: '4-dot LED', compatibility: 'All USB devices', iphone_charges: '~1 charge for iPhone 15', use_case: 'Travel, emergency' },
    images: ['https://www.boat-lifestyle.com/cdn/shop/products/boatEnergyshroom5000.jpg'],
    price: 799,
    stock: 220,
  },
]

// ─── Embedding helper ─────────────────────────────────────────────────────────

function buildEmbeddingText(p: SeedProduct): string {
  const specsText = Object.entries(p.specs)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ')
  return `${p.name} ${p.brand} ${p.category} ${p.description} ${specsText}`
    .trim()
    .slice(0, 8000)
}

// ─── Seed ─────────────────────────────────────────────────────────────────────

async function seed() {
  const client = await pool.connect()

  try {
    console.log('🌱 Starting Stok Phase 1 seed...\n')

    // Insert sellers
    console.log('Inserting sellers...')
    const sellerIds: string[] = []
    for (const s of sellers) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO sellers (name, email, trust_score, fulfillment_rate, dispute_rate, avg_delivery_days)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [s.name, s.email, s.trust_score, s.fulfillment_rate, s.dispute_rate, s.avg_delivery_days]
      )
      sellerIds.push(rows[0].id)
      console.log(`  ✓ ${s.name} (${rows[0].id})`)
    }

    // Products have no natural unique key, so re-running would duplicate them.
    const { rows: existing } = await client.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM products WHERE is_sandbox = false'
    )
    if (existing[0].n > 0) {
      console.log(`\nCatalog already has ${existing[0].n} products — skipping product seed.`)
      return
    }

    // Disable the embedding trigger during seed — we generate embeddings inline
    // (same provider as the API), so the trigger would only duplicate the work.
    await client.query('ALTER TABLE products DISABLE TRIGGER on_product_upsert')

    console.log(`\nInserting ${products.length} products with embeddings...`)
    console.log(process.env.EMBEDDING_PROVIDER === 'openai'
      ? '(Calling OpenAI for each product — expect ~60s)\n'
      : '(Using local embeddings — no API key needed)\n')

    let inserted = 0
    for (const [i, p] of products.entries()) {
      // Alternate between sellers
      const sellerId = sellerIds[i % sellerIds.length]

      // Generate embedding
      const embeddingText = buildEmbeddingText(p)
      const embedding = await generateEmbedding(embeddingText)

      await client.query(
        `INSERT INTO products
           (seller_id, name, brand, category, description, specs, images, price, currency, stock, availability, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'INR', $9, 'in_stock', $10::vector)
         ON CONFLICT DO NOTHING`,
        [
          sellerId,
          p.name,
          p.brand,
          p.category,
          p.description,
          JSON.stringify(p.specs),
          p.images,
          p.price,
          p.stock,
          JSON.stringify(embedding),
        ]
      )

      inserted++
      console.log(`  [${inserted}/${products.length}] ✓ ${p.name}`)
    }

    // Re-enable trigger for production inserts going forward
    await client.query('ALTER TABLE products ENABLE TRIGGER on_product_upsert')

    // Verification queries
    console.log('\n─── Verification ────────────────────────────────────────')

    const { rows: sellerRows } = await client.query('SELECT id, name, trust_score FROM sellers')
    console.log(`\nSellers (${sellerRows.length}):`)
    sellerRows.forEach((r) => console.log(`  ${r.name} — trust_score: ${r.trust_score}`))

    const { rows: countRows } = await client.query('SELECT COUNT(*) FROM products')
    console.log(`\nTotal products: ${countRows[0].count}`)

    const { rows: nullEmbedRows } = await client.query(
      'SELECT COUNT(*) FROM products WHERE embedding IS NULL'
    )
    console.log(`Products missing embeddings: ${nullEmbedRows[0].count}`)

    const { rows: dimRows } = await client.query(
      "SELECT array_length(embedding::real[], 1) AS dims FROM products LIMIT 1"
    )
    console.log(`Embedding dimensions: ${dimRows[0]?.dims ?? 'N/A'}`)

    const { rows: svRows } = await client.query(
      'SELECT COUNT(*) FROM products WHERE search_vector IS NULL'
    )
    console.log(`Products missing search_vector: ${svRows[0].count}`)

    if (Number(nullEmbedRows[0].count) === 0) {
      console.log('\n✅ Phase 1 seed complete — all products have embeddings.')
    } else {
      console.log('\n⚠️  Some products are missing embeddings — check EMBEDDING_PROVIDER / OPENAI_API_KEY.')
    }
  } finally {
    client.release()
    await pool.end()
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
