const units = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen'
];

const tens = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'
];

function convertLessThanThousand(n: number): string {
  if (n === 0) return '';
  let str = '';
  if (n >= 100) {
    str += units[Math.floor(n / 100)] + ' Hundred ';
    n %= 100;
  }
  if (n > 0) {
    if (n < 20) {
      str += units[n] + ' ';
    } else {
      str += tens[Math.floor(n / 10)] + ' ';
      if (n % 10 > 0) {
        str += units[n % 10] + ' ';
      }
    }
  }
  return str;
}

export function convertAmountToWords(amount: number): string {
  if (amount === 0) return 'Rupees Zero Only';

  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);

  const rupees = Math.floor(absAmount);
  const paise = Math.round((absAmount - rupees) * 100);

  let result = '';

  const crore = Math.floor(rupees / 10000000);
  let remainder = rupees % 10000000;

  const lakh = Math.floor(remainder / 100000);
  remainder = remainder % 100000;

  const thousand = Math.floor(remainder / 1000);
  remainder = remainder % 1000;

  if (crore > 0) {
    result += convertLessThanThousand(crore) + 'Crore ';
  }
  if (lakh > 0) {
    result += convertLessThanThousand(lakh) + 'Lakh ';
  }
  if (thousand > 0) {
    result += convertLessThanThousand(thousand) + 'Thousand ';
  }
  if (remainder > 0) {
    result += convertLessThanThousand(remainder);
  }

  result = result.trim();
  let finalStr = isNegative ? 'Minus Rupees ' + result : 'Rupees ' + result;

  if (paise > 0) {
    finalStr += ' and ' + convertLessThanThousand(paise).trim() + ' Paise';
  }

  finalStr += ' Only';
  return finalStr.replace(/\s+/g, ' ');
}
