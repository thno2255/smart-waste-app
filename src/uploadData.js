import { collection, addDoc } from "firebase/firestore";
import { db } from "./firebase";

// ⚠️ شغّل هذا الملف مرة واحدة فقط لرفع البيانات، ثم علّق السطر الأخير
const stations = [
  { name: "محطة حي الخليج",   district: "حي الخليج",   fillLevel: 47, pressure: 3.5, wasteType: "عضوية",   dailyWaste: 191 },
  { name: "محطة حي الريان",   district: "حي الريان",   fillLevel: 99, pressure: 1.7, wasteType: "بلاستيك", dailyWaste: 65  },
  { name: "محطة حي الإسكان",  district: "حي الإسكان",  fillLevel: 42, pressure: 1.5, wasteType: "معادن",   dailyWaste: 167 },
  { name: "محطة حي السلامة",  district: "حي السلامة",  fillLevel: 53, pressure: 3.5, wasteType: "عضوية",   dailyWaste: 93  },
  { name: "محطة حي الفايزية", district: "حي الفايزية", fillLevel: 44, pressure: 2.4, wasteType: "ورق",     dailyWaste: 250 },
  { name: "محطة حي الأفق",    district: "حي الأفق",    fillLevel: 76, pressure: 3.1, wasteType: "مختلط",   dailyWaste: 220 },
  { name: "محطة حي النخيل",   district: "حي النخيل",   fillLevel: 62, pressure: 2.8, wasteType: "مختلط",   dailyWaste: 150 },
  { name: "محطة حي الروابي",  district: "حي الروابي",  fillLevel: 88, pressure: 3.2, wasteType: "بلاستيك", dailyWaste: 175 },
  { name: "محطة حي الحمراء",  district: "حي الحمراء",  fillLevel: 92, pressure: 1.3, wasteType: "زجاج",    dailyWaste: 161 },
  { name: "محطة حي الشروق",   district: "حي الشروق",   fillLevel: 35, pressure: 1.9, wasteType: "مختلط",   dailyWaste: 145 },
];

const uploadData = async () => {
  for (const station of stations) {
    await addDoc(collection(db, "stations"), station);
  }
  console.log("✅ تم رفع البيانات - علّق هذا السطر الآن!");
};

// ⚠️ أبقِ هذا السطر معلّقاً بعد أول تشغيل لمنع التكرار
// uploadData();
