# 💰 Fly.io Cost Optimization Analysis

## Current vs Optimized Configuration

### **BEFORE Optimization**
- **CPU/RAM**: `shared-cpu-1x` with 1GB RAM
- **Cost**: $5.92/month (running 24/7)
- **Volume**: 1GB = $0.15/month  
- **Sleep mode**: Disabled (always running)
- **Total**: ~$6.07/month

### **AFTER Optimization** ⚡
- **CPU/RAM**: `shared-cpu-1x` with 256MB RAM  
- **Cost**: $2.02/month (when running)
- **Volume**: 1GB = $0.15/month
- **Sleep mode**: Enabled (5min timeout)
- **Estimated usage**: ~10% active time
- **Total**: ~$0.35/month (83% SAVINGS!)

## 📊 Detailed Cost Breakdown

### **Compute Costs (Stockholm region)**
| Configuration | RAM | Price/hour | Price/month | With sleep (90% savings) |
|---------------|-----|------------|-------------|---------------------------|
| **shared-cpu-1x** | 256MB | $0.0028 | $2.02 | **$0.20** ✅ |
| shared-cpu-1x | 512MB | $0.0046 | $3.32 | $0.33 |
| shared-cpu-1x | 1GB | $0.0082 | $5.92 | $0.59 |
| shared-cpu-1x | 2GB | $0.0154 | $11.11 | $1.11 |

### **Storage Costs**
- **Volume**: 1GB persistent storage = $0.15/month
- **Container storage**: 142MB (when stopped) = $0.021/month
- **Total storage**: $0.171/month

### **Network Costs**
- **IPv4**: Shared (free)
- **IPv6**: Unlimited anycast (free)  
- **Data transfer**: Europe region = $0.02/GB
- **Estimated usage**: <1GB/month = <$0.02/month

## 🎯 Why 256MB RAM is Perfect

### **Your App's Memory Requirements**
Based on your performance analysis:
- **Node.js runtime**: ~50-80MB
- **Application code**: ~10-20MB  
- **JSON data loading**: ~5-15MB (async)
- **Express + middleware**: ~10-20MB
- **Buffer/overhead**: ~50MB
- **Total estimated**: ~125-185MB

### **256MB vs 1GB Comparison**
- **256MB**: Perfect fit with headroom
- **1GB**: 4x more than needed = wasted money
- **Cost difference**: $3.90/month saved

## 🚀 Sleep Mode Optimization

### **Traffic Pattern Analysis**
For a viikkopelit schedule site:
- **Peak usage**: Evenings/weekends when people check games
- **Low usage**: Weekday mornings, late nights
- **Estimated active time**: ~10-20% of total time

### **Sleep Configuration**
- **Autostop timeout**: 5 minutes (aggressive savings)
- **Startup time**: 78ms (your optimization!)
- **User experience**: Virtually instant wake-up

### **Monthly Savings**
- **Without sleep**: $2.02/month (24/7 running)
- **With sleep (90% downtime)**: $0.20/month
- **Savings**: $1.82/month (90% reduction!)

## 📈 Total Monthly Cost Estimate

| Component | Cost | Notes |
|-----------|------|-------|
| **Compute** (256MB) | $0.20 | With 90% sleep time |
| **Storage** (1GB volume) | $0.15 | Persistent data |
| **Container storage** | $0.02 | When stopped |
| **Network** | $0.02 | Minimal traffic |
| **Total** | **$0.39/month** | **83% savings!** |

## 🔄 Migration Steps

### **1. Deploy Optimized Configuration**
```bash
# Deploy with new fly.toml settings
fly deploy

# Verify deployment
fly status
```

### **2. Test Sleep/Wake Cycle**
```bash
# Check if machine stops after 5 minutes
fly logs -f

# Test wake-up time
curl https://ols-viikkopelit.fly.dev/health
```

### **3. Monitor Cost in Dashboard**
- Check Fly.io billing dashboard after a few days
- Verify sleep mode is working
- Confirm cost reduction

## 🏆 Benefits Summary

### **Cost Optimization**
- **Monthly cost**: $6.07 → $0.39 (83% reduction)
- **Annual savings**: ~$68/year
- **Perfect for low-traffic apps**

### **Performance Maintained**
- **Cold start**: Still 78ms (your optimization!)
- **User experience**: No noticeable delay
- **Reliability**: Health checks ensure availability

### **Resource Right-Sizing**
- **Memory**: 1GB → 256MB (perfectly sized)
- **Docker image**: 282MB → 142MB (50% smaller)
- **Storage**: Optimized volume usage

---

**Recommendation**: ✅ **Deploy immediately**  
**Risk level**: 🟢 **Low** (easily reversible)  
**Expected savings**: 💰 **83% cost reduction**
